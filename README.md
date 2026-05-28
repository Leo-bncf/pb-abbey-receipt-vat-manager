# pb-abbey-receipt-vat-manager

> AI-powered receipt management and VAT extraction tool for **PB Abbey Ltd**. Upload receipts, let the AI extract the data, review and correct it, then export clean reports.

---

## What is this?

An internal web app built for PB Abbey Ltd to replace manual receipt processing. Drop a PDF or photo of a receipt — the AI pulls out vendor name, date, amount, VAT, currency — then an admin reviews the extraction, corrects any mistakes, and feeds that correction back as training data to improve future accuracy.

Four pages: **Upload → Dashboard → Reports → Admin**.

---

## Features

- 📤 **Drag & drop upload** — accepts PDF, JPG, PNG; batch upload supported
- 🤖 **AI extraction** — automatically pulls vendor, date, total amount, VAT rate, currency from each receipt
- ✅ **Review workflow** — extracted fields shown side-by-side with the original; admins can correct any field inline
- 🏋️ **AI training loop** — corrections are sent back as feedback to improve extraction over time
- 📊 **Dashboard** — sortable, filterable receipt table with status badges (`uploaded → processing → extracted → reviewed → error`)
- 📑 **Reports** — export to XLSX or PDF
- 🔐 **Role-based access** — Admin panel hidden from non-admin users

---

## Pages

| Route | Description |
|---|---|
| `/Upload` | Drop zone to upload new receipts (PDF/image) |
| `/Dashboard` | Full receipt table with sorting, filtering, bulk selection |
| `/Reports` | Export reviewed receipts to XLSX/PDF |
| `/Admin` | AI training panel, bulk reprocessing, feedback chat |

---

## Receipt Lifecycle

```
uploaded → processing → extracted → reviewed → (exported)
                                  ↓
                            error (retry)
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite |
| UI | Tailwind CSS, shadcn/ui, Radix UI, Framer Motion |
| Backend / Auth | Base44 SDK |
| Export | jsPDF, xlsx |
| Forms | React Hook Form, Zod |
| State | TanStack Query |

---

## Quick Start

```bash
git clone https://github.com/Leo-bncf/pb-abbey-receipt-vat-manager
cd pb-abbey-receipt-vat-manager

npm install
cp .env.example .env  # add your Base44 API key

npm run dev
# → http://localhost:5173
```

---

## Admin Panel

The `/Admin` route (admin role only) includes:

- **AI Training Panel** — review extracted fields per receipt, correct them, submit feedback
- **AI Learning Tab** — visualize training history and model improvement
- **Receipt Review Panel** — bulk review queue
- **AI Bulk Training** — reprocess multiple receipts at once
- **AI Feedback Chat** — chat interface to guide extraction behavior

---

## Notes

- Only admins can access the `/Admin` route — the nav item is hidden for regular users
- Supported upload formats: `.pdf`, `.jpg`, `.jpeg`, `.png`
- Currency support: GBP (£), EUR (€), USD ($)

---

*Internal tool — PB Abbey Ltd*
