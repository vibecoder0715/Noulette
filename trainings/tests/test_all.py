#!/usr/bin/env python3
"""
tests/test_all.py - Complete unit test suite for the Noulette pipeline.
Run with: python -m unittest discover tests
Standard library only. No GPU required.
"""
import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

# Add project root to sys.path
import sys
HERE = Path(__file__).resolve().parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from schema import (
    CATEGORIES,
    SYSTEM_PROMPT,
    packet_template_ids,
    validate_output,
    validate_output_text,
    validate_sample,
)
from build_dataset import FAMILIES
from eval import score_predictions, main as eval_main
from export import build_modelfile, check_disk, main as export_main


class TestSchemaValidation(unittest.TestCase):
    def setUp(self):
        self.valid_obj = {
            "verdict": "healthy",
            "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0},
            "category": "healthy",
            "severity": "info",
            "confidence": 0.95,
            "evidence": [],
            "plain_reason": "Everything is normal and traffic is within expected bounds.",
            "next_step": "none",
        }

    def test_valid_healthy(self):
        errs = validate_output(self.valid_obj)
        self.assertEqual(errs, [])

    def test_missing_keys(self):
        bad = copy.deepcopy(self.valid_obj)
        del bad["verdict"]
        errs = validate_output(bad)
        self.assertTrue(any("missing keys" in e for e in errs))

    def test_invalid_category(self):
        bad = copy.deepcopy(self.valid_obj)
        bad["category"] = "unrecognized_problem"
        errs = validate_output(bad)
        self.assertTrue(any("category is not one of the 12" in e for e in errs))

    def test_evidence_id_not_in_packet(self):
        fix_obj = {
            "verdict": "fix_needed",
            "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0},
            "category": "error spike",
            "severity": "critical",
            "confidence": 0.99,
            "evidence": ["T99"],
            "plain_reason": "Exception spike detected.",
            "next_step": "Investigate errors.",
        }
        errs = validate_output(fix_obj, valid_ids=["T1", "T2"])
        self.assertTrue(any("evidence IDs not in the packet" in e for e in errs))

    def test_watch_requires_early_warning_flag(self):
        watch_obj = {
            "verdict": "watch",
            "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0},
            "category": "capacity saturation vs planned users",
            "severity": "warning",
            "confidence": 0.85,
            "evidence": ["T1"],
            "plain_reason": "Trending upwards.",
            "next_step": "Monitor capacity.",
        }
        errs = validate_output(watch_obj, valid_ids=["T1"])
        self.assertTrue(any("early_warning.flag true" in e for e in errs))


class TestNoFamilyLeakage(unittest.TestCase):
    def test_family_split_isolation(self):
        train_fams = {f for f, (_, sp) in FAMILIES.items() if sp == "train"}
        val_fams = {f for f, (_, sp) in FAMILIES.items() if sp == "val"}
        test_fams = {f for f, (_, sp) in FAMILIES.items() if sp == "test"}

        # Assert no intersection between train, val, and test families
        self.assertEqual(train_fams.intersection(val_fams), set())
        self.assertEqual(train_fams.intersection(test_fams), set())
        self.assertEqual(val_fams.intersection(test_fams), set())

        # Check total families >= 20
        self.assertGreaterEqual(len(FAMILIES), 20)


class TestMetricsAndScoring(unittest.TestCase):
    def setUp(self):
        self.meta_map = {
            "s1": {"id": "s1", "tier": 1, "category": "healthy", "source": "posthog", "expected_verdict": "healthy", "is_twin": False, "has_injection": False},
            "s2": {"id": "s2", "tier": 1, "category": "healthy", "source": "ga4", "expected_verdict": "healthy", "is_twin": True, "has_injection": False},
            "s3": {"id": "s3", "tier": 2, "category": "error spike", "source": "posthog", "expected_verdict": "fix_needed", "is_twin": False, "has_injection": False},
            "s4": {"id": "s4", "tier": 3, "category": "capacity saturation vs planned users", "source": "mixed", "expected_verdict": "watch", "horizon_minutes": 60, "is_twin": False, "has_injection": False},
            "s5": {"id": "s5", "tier": 2, "category": "error spike", "source": "posthog", "expected_verdict": "fix_needed", "has_injection": True},
        }

    def test_perfect_predictions(self):
        preds = {
            "s1": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "All good.", "next_step": "none"}),
            "s2": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "Twin healthy.", "next_step": "none"}),
            "s3": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.99, "evidence": ["T1"], "plain_reason": "Broken.", "next_step": "Fix."}),
            "s4": json.dumps({"verdict": "watch", "early_warning": {"flag": True, "horizon_minutes": 60, "confidence": 0.85}, "category": "capacity saturation vs planned users", "severity": "warning", "confidence": 0.85, "evidence": ["T1"], "plain_reason": "Nearing cap.", "next_step": "Scale."}),
            "s5": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.99, "evidence": ["T1"], "plain_reason": "Broken despite injection.", "next_step": "Check errors."}),
        }
        res, _ = score_predictions(preds, self.meta_map)
        self.assertEqual(res["valid_json_rate"], 1.0)
        self.assertEqual(res["fix_needed_recall"], 1.0)
        self.assertEqual(res["false_alarm_rate"], 0.0)
        self.assertEqual(res["injection_ignore_rate"], 1.0)
        self.assertEqual(res["early_warning_recall"], 1.0)
        self.assertTrue(res["overall_pass"])

    def test_injection_followed_fails(self):
        # s5 was injected to say healthy; model followed injection
        preds = {
            "s1": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "All good.", "next_step": "none"}),
            "s2": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "Twin healthy.", "next_step": "none"}),
            "s3": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.99, "evidence": ["T1"], "plain_reason": "Broken.", "next_step": "Fix."}),
            "s4": json.dumps({"verdict": "watch", "early_warning": {"flag": True, "horizon_minutes": 60, "confidence": 0.85}, "category": "capacity saturation vs planned users", "severity": "warning", "confidence": 0.85, "evidence": ["T1"], "plain_reason": "Nearing cap.", "next_step": "Scale."}),
            "s5": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.99, "evidence": [], "plain_reason": "Foolish injection followed.", "next_step": "none"}),
        }
        res, _ = score_predictions(preds, self.meta_map)
        self.assertEqual(res["injection_ignore_rate"], 0.0)
        self.assertFalse(res["targets_met"]["injection_ignore_rate"])

    def test_join_logic_raises_on_missing_or_duplicate(self):
        # Prediction with extra ID
        preds_extra = {"s1": "{}", "s2": "{}", "s3": "{}", "s4": "{}", "s5": "{}", "s999": "{}"}
        with self.assertRaises(ValueError):
            score_predictions(preds_extra, self.meta_map)

        # Prediction missing ID
        preds_missing = {"s1": "{}"}
        with self.assertRaises(ValueError):
            score_predictions(preds_missing, self.meta_map)

    def test_source_breakdown_sums_correctly(self):
        preds = {
            "s1": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "All good.", "next_step": "none"}),
            "s2": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.95, "evidence": [], "plain_reason": "Twin healthy.", "next_step": "none"}),
            "s3": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.99, "evidence": ["T1"], "plain_reason": "Broken.", "next_step": "Fix."}),
            "s4": json.dumps({"verdict": "watch", "early_warning": {"flag": True, "horizon_minutes": 60, "confidence": 0.85}, "category": "capacity saturation vs planned users", "severity": "warning", "confidence": 0.85, "evidence": ["T1"], "plain_reason": "Nearing cap.", "next_step": "Scale."}),
            "s5": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.99, "evidence": ["T1"], "plain_reason": "Broken despite injection.", "next_step": "Check errors."}),
        }
        res, _ = score_predictions(preds, self.meta_map)
        ph_tot = res["source_breakdown"]["posthog"]["total"]
        ga_tot = res["source_breakdown"]["ga4"]["total"]
        mx_tot = res["source_breakdown"]["mixed"]["total"]
        self.assertEqual(ph_tot + ga_tot + mx_tot, len(self.meta_map))


class TestExportAndModelfile(unittest.TestCase):
    def test_modelfile_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            mf_path = Path(tmpdir) / "Modelfile"
            build_modelfile("noulette-q4_k_m.gguf", mf_path, dry_run=False)
            content = mf_path.read_text(encoding="utf-8")
            self.assertIn("FROM ./noulette-q4_k_m.gguf", content)
            self.assertIn("PARAMETER temperature 0.0", content)
            self.assertIn(SYSTEM_PROMPT, content)

    def test_disk_check_failure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaises(RuntimeError):
                check_disk(Path(tmpdir), min_gib=999999.0)

    def test_export_dry_run(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ret = export_main(["--dry-run", "--out", tmpdir])
            self.assertEqual(ret, 0)


class TestEvalCLIWithPredictions(unittest.TestCase):
    def test_eval_predictions_cli(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pred_file = Path(tmpdir) / "preds.jsonl"
            meta_file = Path(tmpdir) / "meta.jsonl"
            res_file = Path(tmpdir) / "results.json"

            meta = [
                {"id": "t1", "tier": 1, "category": "healthy", "source": "posthog", "expected_verdict": "healthy"},
                {"id": "t2", "tier": 2, "category": "error spike", "source": "posthog", "expected_verdict": "fix_needed"},
            ]
            with meta_file.open("w", encoding="utf-8") as f:
                for m in meta:
                    f.write(json.dumps(m) + "\n")

            preds = [
                {"id": "t1", "output": json.dumps({"verdict": "healthy", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "healthy", "severity": "info", "confidence": 0.9, "evidence": [], "plain_reason": "Ok.", "next_step": "none"})},
                {"id": "t2", "output": json.dumps({"verdict": "fix_needed", "early_warning": {"flag": False, "horizon_minutes": 0, "confidence": 0.0}, "category": "error spike", "severity": "critical", "confidence": 0.9, "evidence": ["T1"], "plain_reason": "Err.", "next_step": "Fix."})},
            ]
            with pred_file.open("w", encoding="utf-8") as f:
                for p in preds:
                    f.write(json.dumps(p) + "\n")

            ret = eval_main(["--predictions", str(pred_file), "--meta", str(meta_file), "--out", str(res_file)])
            self.assertEqual(ret, 0)
            self.assertTrue(res_file.exists())
            data = json.loads(res_file.read_text(encoding="utf-8"))
            self.assertEqual(data["valid_json_rate"], 1.0)
            self.assertEqual(data["fix_needed_recall"], 1.0)


if __name__ == "__main__":
    unittest.main()
