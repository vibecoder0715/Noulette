import { describe, it, expect } from 'bun:test';
import { scanCodeAst } from '../../packages/engine/src/steps/10-code-mistakes.js';

describe('Multi-Language AST & Taint Tracking Scanner (Gap 3 Remediation)', () => {
  describe('JavaScript/TypeScript Taint Tracking', () => {
    it('Detects real-world multi-step SQL injection through intermediate variables', () => {
      const code = `
        const userId = req.query.id;
        const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
        db.query(query);
      `;
      const findings = scanCodeAst('src/users.ts', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-SQL-001')).toBe(true);
    });

    it('Detects command injection via variable assignment into child_process.exec', () => {
      const code = `
        const host = req.body.hostname;
        const cmd = "ping -c 1 " + host;
        cp.exec(cmd);
      `;
      const findings = scanCodeAst('src/network.js', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-CMD-001')).toBe(true);
    });
  });

  describe('Python Scanner', () => {
    it('Detects Python SQL injection via f-string in cursor.execute', () => {
      const code = `
        def get_user(request):
            user_id = request.GET.get('id')
            query = f"SELECT * FROM accounts WHERE id = {user_id}"
            cursor.execute(query)
      `;
      const findings = scanCodeAst('views.py', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-PY-SQL-001')).toBe(true);
    });

    it('Detects Python command injection with subprocess.Popen shell=True', () => {
      const code = `
        import subprocess
        def run_task(user_input):
            subprocess.Popen(f"echo {user_input}", shell=True)
      `;
      const findings = scanCodeAst('tasks.py', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-PY-CMD-001')).toBe(true);
    });

    it('Detects Python unsafe deserialization with pickle.loads', () => {
      const code = `
        import pickle
        def load_session(data):
            return pickle.loads(data)
      `;
      const findings = scanCodeAst('session.py', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-PY-DESER-001')).toBe(true);
    });
  });

  describe('Go Scanner', () => {
    it('Detects Go SQL injection via fmt.Sprintf in db.Query', () => {
      const code = `
        func GetUser(w http.ResponseWriter, r *http.Request) {
            id := r.URL.Query().Get("id")
            rows, err := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", id))
        }
      `;
      const findings = scanCodeAst('user.go', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-GO-SQL-001')).toBe(true);
    });

    it('Detects Go command injection with exec.Command invoking shell', () => {
      const code = `
        func Execute(userCmd string) {
            cmd := exec.Command("sh", "-c", userCmd)
            cmd.Run()
        }
      `;
      const findings = scanCodeAst('runner.go', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-GO-CMD-001')).toBe(true);
    });
  });

  describe('Rust Scanner', () => {
    it('Detects Rust command injection with Command::new("sh").arg("-c")', () => {
      const code = `
        use std::process::Command;
        fn run_script(input: &str) {
            Command::new("sh").arg("-c").arg(input).output().unwrap();
        }
      `;
      const findings = scanCodeAst('main.rs', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-RS-CMD-001')).toBe(true);
    });

    it('Detects Rust SQL injection with sqlx::query(&format!(...))', () => {
      const code = `
        async fn fetch_user(pool: &SqlitePool, id: &str) {
            let row = sqlx::query(&format!("SELECT * FROM users WHERE id = '{}'", id))
                .fetch_one(pool)
                .await;
        }
      `;
      const findings = scanCodeAst('db.rs', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-RS-SQL-001')).toBe(true);
    });
  });

  describe('Java Scanner', () => {
    it('Detects Java SQL injection with statement.executeQuery string concatenation', () => {
      const code = `
        public void doGet(HttpServletRequest req, HttpServletResponse res) throws Exception {
            String id = req.getParameter("id");
            Statement stmt = conn.createStatement();
            ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE id = '" + id + "'");
        }
      `;
      const findings = scanCodeAst('UserServlet.java', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-JAVA-SQL-001')).toBe(true);
    });

    it('Detects Java command injection with Runtime.getRuntime().exec', () => {
      const code = `
        public void execute(HttpServletRequest req) throws Exception {
            String cmd = req.getParameter("cmd");
            Runtime.getRuntime().exec("sh -c " + cmd);
        }
      `;
      const findings = scanCodeAst('CommandExecutor.java', code, 'cand_1');
      expect(findings.some(f => f.ruleId === 'CODE-JAVA-CMD-001')).toBe(true);
    });
  });
});
