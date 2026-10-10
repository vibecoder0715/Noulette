# Noulette

[English](README_en.md) | [简体中文](README_cn.md) | [Bahasa Melayu](README_bm.md)

---

## 1. Pakej Muat Turun & Pemasangan Windows

Anda boleh memuat turun pakej pelepasan rasmi terkini terus daripada GitHub Releases atau mengakses binaan siap guna dalam folder `dist/`:

| Pakej | Format | Saiz | Penerangan | Pautan Muat Turun |
| :--- | :--- | :--- | :--- | :--- |
| **Noulette Mudah Alih (Standalone)** | `.exe` (Portabel) | ~104 MB | Aplikasi fail tunggal kendiri untuk CLI dan Desktop GUI tanpa pemasangan. | [📥 Muat Turun `noulette.exe`](https://github.com/noulette/noulette/releases/latest/download/noulette.exe) (Tempatan: `dist/noulette.exe`) |
| **Pemasang Windows Noulette** | `.msi` (Installer) | ~40 MB | Pakej Pemasang Windows piawai dengan pintasan Menu Mula dan sokongan nyahpasang automatik. | [📥 Muat Turun `noulette-setup.msi`](https://github.com/noulette/noulette/releases/latest/download/noulette-setup.msi) (Tempatan: `dist/noulette-setup.msi`) |

### Mod Operasi:
- **Mod Desktop**: Dwiklik `noulette.exe` (atau lancarkan melalui Menu Mula selepas memasang `.msi`) untuk membuka antara muka visual (dibina dengan Tauri 2 dan sistem reka bentuk Terra).
- **Mod Baris Arahan (CLI)**: Jalankan `noulette.exe <arahan>` dalam terminal anda (seperti `scan`, `gate`, `clone`, atau `mcp`) untuk menggunakan enjin secara langsung.
- **Sifar Kebergantungan Luaran**: Tiada persekitaran masa laksana luaran (Node.js, Bun, atau Python) diperlukan pada komputer anda.

---

## 2. Misi dan Visi Kami

Misi kami adalah membantu pasukan pembangun membina perisian dengan yakin dengan mengesan masalah sebelum kod dihantar ke persekitaran pengeluaran. Kami memberi tumpuan kepada tiga matlamat utama:

1. **Mengesan Pelbagai Masalah Perisian**:
   Kami mengenal pasti isu sebenar yang lazimnya terlepas daripada pandangan alat semakan biasa. Contohnya:
   - *Ancaman Keselamatan Siber*: Kunci awan dan token API yang bocor, skrip pra-pemasangan yang berbahaya, suntikan arahan, serta muslihat Unicode tersembunyi (seperti aksara sifar-lebar atau pengubah hala teks bidi).
   - *Kelemahan Logik & Operasi Perniagaan*: Kawalan akses yang tidak lengkap, kelemahan IDOR, dan aliran data yang boleh menjejaskan privasi pengguna.
   - *Ketidakpadanan Seni Bina*: Sistem yang dibina terlalu rumit secara berlebihan, atau reka bentuk tidak mencukupi yang tidak mampu menampung sasaran trafik pengguna dan bajet anda.

2. **Membuat Keputusan yang Tepat dan Wajar**:
   Daripada membebankan anda dengan amaran bising yang tidak jelas, Noulette menyediakan pilihan berasaskan bukti yang kukuh. Anda boleh melihat perbezaan kod yang dineutralkan secara visual, menyemak senarai bukti, menandatangani perubahan yang diluluskan dengan kunci kriptografi Ed25519, atau merekod pengecualian risiko bertempoh terhad dengan pemilikan yang jelas.

3. **Mengesahkan dan Membaiki Sebelum Dilancarkan**:
   Mengesan masalah hanyalah sebahagian daripada penyelesaian. Sekiranya anda mahu, Noulette mencadangkan pembaikan calon automatik serta tampalan kod yang disasarkan. Anda boleh menyemak pengubahsuaian tepat, menguji pembaikan dalam pengasingan, dan merekod keputusan yang bersempadan—memastikan bahawa pelepasan yang disahkan mendokumentasikan perkara yang telah diuji dan perkara yang berada di luar skop pengesahan.

---

## 3. Fungsi Utama & Persekitaran

Noulette menyediakan pengesahan bersempadan yang telus melalui tiga fungsi utama:
1. Saluran Penerimaan Terasing: Memeriksa arkib dan repositori yang dimuat turun dalam kuarantin sebelum penerimaan.
2. Pengesahan Pra-Pelepasan: Menjalankan 142 peraturan TrapCheck, pengimbas maklumat rahsia, analisis AST berbilang bahasa, dan semakan binaan sebelum melancarkan kod.
3. Perancangan Seni Bina: Menilai tindanan teknologi projek secara dinamik untuk mengenal pasti sistem yang terlebih rumit atau kurang dibina mengikut bajet dan skala pengguna.

*Prinsip Asas: Noulette TIDAK PERNAH mendakwa bahawa kod adalah "selamat" atau bahawa kerentanan telah dihapuskan sepenuhnya. Setiap resit pelepasan merekodkan penilaian peraturan yang disahkan secara telus dan menyatakan dengan jelas kawasan yang belum diperiksa.*

Persekitaran:
Boleh digunakan sebagai aplikasi desktop semua-dalam-satu, alat baris arahan (CLI), dan pelayan MCP untuk pembantu AI menggunakan penghurai AST berbilang bahasa dan penganalisis kesan aliran data.

---

## 4. Penghargaan Khas

Noulette dapat direalisasikan hasil sumbangan projek sumber terbuka yang hebat ini beserta para penyumbangnya:

- [Tauri](https://github.com/tauri-apps/tauri) — Rangka kerja aplikasi desktop yang ringan, pantas, dan selamat.
- [Bun](https://github.com/oven-sh/bun) — Persekitaran masa laksana JavaScript/TypeScript, pembundel, dan penguji yang sangat pantas.
- [React](https://github.com/facebook/react) — Pustaka untuk membina antara muka pengguna web dan asli.
- [Vite](https://github.com/vitejs/vite) — Alat binaan bahagian hadapan generasi baharu.
- [Lucide](https://github.com/lucide-icons/lucide) — Set ikon vektor yang kemas dan konsisten.
- [Rust](https://github.com/rust-lang/rust) & pustaka berkaitan:
  - `ed25519-dalek` & `curve25519-dalek` oleh [dalek-cryptography](https://github.com/dalek-cryptography)
  - `serde` oleh [serde-rs](https://github.com/serde-rs)
  - `regex` oleh Pembangun Projek Rust
  - `sha2` oleh [RustCrypto](https://github.com/RustCrypto)
- [Gitleaks](https://github.com/gitleaks/gitleaks) — Inspirasi peraturan dan corak bagi pengesanan maklumat rahsia.
- [TypeScript](https://github.com/microsoft/TypeScript) oleh Microsoft.

---

## 5. Lesen

Projek ini dilesenkan di bawah Lesen MIT. Sila rujuk [LICENSE.md](LICENSE.md) untuk maklumat lanjut.
