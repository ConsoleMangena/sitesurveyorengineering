# SiteSurveyor Engineering

**The all-in-one operating system for engineering survey firms — from planning to payday.**

SiteSurveyor Engineering brings the entire surveyor workflow into a single platform: plan and schedule projects, run rigorous survey computations and CAD drafting in the browser or on the desktop, dispatch field crews, track instruments, quote and invoice clients, and settle payments on-chain with Solana.

What sets it apart:

- **Your survey data, secured on-chain.** Engineering survey records — title-deed coordinates, control data, CAD models, and field files — are highly sensitive. SiteSurveyor lets surveyors anchor these files to the **Solana blockchain** for tamper-evident, verifiable, and durable security, so a deliverable's integrity can be proven cryptographically rather than trusted blindly.
- **Hybrid on-chain / off-chain by choice.** You decide, per file, what goes **on-chain** (maximum security and immutability) versus **off-chain** in the Supabase database and storage (fast and affordable). This keeps everyday work cheap while reserving the blockchain for the records that truly need it — the best of both Web 2.0 and Web 3.0.
- **Direct on-chain payments.** Pay network gas fees directly from your wallet and settle client invoices in crypto — all verified on-chain through Supabase Edge Functions.
- **A real engineering core, not a thin CRM.** Survey geometry (TIN surfaces, contours, volumes, and a full COGO toolset) is computed by a single Rust engine that runs identically as WebAssembly in the browser and natively on the Tauri desktop app — deterministic and unit-tested to survey tolerance.
- **Built for teams and tenants.** Personal, Business, and Platform Admin workspaces sit on a multi-tenant foundation with PostgreSQL Row-Level Security and role-based access control, plus a feature marketplace to unlock add-ons on demand.

Built by **Eineva Incorporated**.

---

## Features

### Personal Workspace (individual surveyors)

**Planning & Project Management**
- Dashboard, schedule, and time tracking
- Project hub with file manager and document storage
- **Blockchain file security** — anchor sensitive survey files (CAD, coordinates, deliverables) to Solana for tamper-evident, verifiable integrity, with a per-file choice between on-chain and off-chain storage

**Surveyor CAD (the engineering core)**
- Full drafting workspace with TIN generation, contour mapping, and volume calculations (cut/fill, surface-to-surface, elevation)
- Complete coordinate geometry (COGO) toolset:
  - Forward / Inverse computations
  - Traverse computation and Bowditch adjustment, plus angular-traverse reduction (interior / deflection / angle-right) with angular-misclosure balancing
  - Levelling (Rise & Fall / HPC)
  - Bearing-bearing and distance-distance intersections
  - Three-point resection (Tienstra)
  - Stake-out / set-out (angle-right, distance and offsets from an occupied station and backsight)
  - Alignment set-out: horizontal circular curves (T, L, E, M, chord + deflection-angle stations) and vertical parabolic curves
  - Polygon area and polyline length
  - Combined scale factor reduction (ground-to-grid)
- Terrain analysis: slope-shaded DTM, aspect, true 3D surface area and whole-surface statistics
- Drawing annotation: coordinate tables, boundary bearing/distance labels and area/perimeter labels
- DXF, CSV and GeoJSON import/export

**Business Operations**
- Quotes and invoicing
- Billing with **Solana crypto payments**
- Contact management (CRM)

**Asset Management**
- Instrument/equipment tracking with calibration scheduling

**Web 3.0 & Marketplace**
- **Pay network gas fees directly from your Solana wallet** when anchoring files or settling on-chain
- **Hybrid storage** — choose, per file, between on-chain (maximum security, immutable) and off-chain Supabase storage (fast, affordable)
- Hire crew / find jobs
- Feature add-on store — unlock capabilities on demand

### Business Workspace (survey firms)
Everything in Personal, plus:
- **Dispatch** — assign jobs to field crews in real time
- **Team management** with role-based access (owner, admin, ops_manager, finance, sales, technician, viewer)
- Job board posting and professional hiring

### Platform Admin Workspace
- Platform-wide metrics and activity monitoring
- Cross-tenant user and workspace management
- Feature request approval workflow
- Full audit log

---

## The Surveyor's Workflow, End to End

```
Planning ──► Field Work ──► Computation ──► Dispatch ──► Billing ──► Payment
   │            │               │               │            │            │
   │            │               │               │            │     Solana │
   │            │     CAD TIN   │               │            │   on-chain │
 Schedule   Instruments   Contours    Assign crew   Invoice     crypto tx
 Projects   Calibration  Volumes     Track status  Quote         ↓
              tracking   COGO                        ↓          Confirmed
                         Traverse               Get paid
                         Levelling               in SOL
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 6, Vite 8, Zustand (auth), react-router-dom 7 |
| **Backend** | Supabase (PostgreSQL 17, RLS, Edge Functions, Storage) |
| **Desktop** | Tauri 2 (Rust) — native shell with IPC to survey-core |
| **Geometry Engine** | Rust → WebAssembly for browsers; native Rust (`survey-core`) for desktop — same code, identical results |
| **Blockchain** | Solana Web3.js — on-chain file anchoring and crypto payments |
| **Testing** | Vitest 4, jsdom, @testing-library/react |
| **Linting** | ESLint 9, typescript-eslint 8 |

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│                Frontend (SPA)                       │
│  React + Vite (TypeScript 6)                       │
│  ┌─────────────┐  ┌────────────────────────┐       │
│  │ WASM module  │  │ Supabase SDK           │       │
│  │ survey-core  │  │ (REST / GraphQL)       │       │
│  └─────────────┘  └───────────┬────────────┘       │
│                               │                     │
│  ┌────────────────────────────┴────────────┐        │
│  │    Solana Wallet Adapter (Web3.js)      │        │
│  └─────────────────────────────────────────┘        │
├─────────────────────────────────┬───────────────────┤
│     Tauri Desktop Shell         │                   │
│  Rust IPC → survey-core (opt)   │                   │
└─────────────────────────────────┼───────────────────┘
                                  │
         ┌────────────────────────┼──────────────────────────┐
         ▼                        ▼                          ▼
┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│   Supabase        │   │   Supabase       │   │    Solana          │
│   PostgreSQL 17   │   │ Edge Functions   │   │   Blockchain       │
│   + RLS           │   │ (Deno / TS)      │   │                    │
│   + Storage       │   │ solana-pay-verify│   │  On-chain payments │
└──────────────────┘   └──────────────────┘   └────────────────────┘
```

The frontend is a single-page application backed entirely by Supabase — no custom backend server. Survey geometry runs as WebAssembly in the browser or over Tauri IPC on desktop, both from the same Rust `survey-core` crate. Solana integration handles on-chain file anchoring and crypto payment verification via Supabase Edge Functions. Multi-tenant isolation is enforced through PostgreSQL Row-Level Security.

---

## Repository Structure

```
├── frontend/                        # React + Vite SPA
│   ├── src/
│   │   ├── main.tsx                 # Entry point (polyfills Buffer for Solana)
│   │   ├── App.tsx                  # Router & auth bootstrap
│   │   ├── pages/                   # Route-level pages
│   │   │   ├── auth/                # Login, signup, password reset
│   │   │   ├── personal/            # Personal workspace
│   │   │   ├── business/            # Business workspace
│   │   │   ├── shared/              # Contacts, invoices, quotes, projects, etc.
│   │   │   └── admin/               # Platform admin
│   │   ├── features/
│   │   │   ├── workspace/           # Workspace type definitions
│   │   │   ├── personal/            # Personal shell & navigation
│   │   │   ├── business/            # Business shell & navigation
│   │   │   ├── platform/            # Platform operator shell
│   │   │   └── projects/            # Surveyor CAD, calculators, tool registry
│   │   ├── components/              # Shared UI (WorkspaceShell, ProtectedRoute, etc.)
│   │   ├── lib/
│   │   │   ├── supabase/            # Client + auto-generated DB types
│   │   │   ├── repositories/        # 25 data access modules
│   │   │   ├── auth/                # Zustand auth store + session management
│   │   │   ├── solana/              # Solana wallet config + provider
│   │   │   ├── payments/            # Payment verification
│   │   │   └── permissions.ts       # RBAC helpers
│   │   └── styles/                  # Hand-written CSS
│   ├── vite.config.ts               # Vite + WASM plugins, es2022 target
│   └── package.json
│
├── backend/                         # Tauri + Rust + Supabase SQL
│   ├── src/                         # Tauri app (main.rs, lib.rs, survey.rs)
│   ├── crates/
│   │   ├── survey-core/             # Pure Rust geometry (TIN, contours, volumes)
│   │   └── survey-wasm/             # wasm-bindgen bindings
│   ├── supabase/
│   │   ├── sql/                     # Schema, functions, RLS, seeds
│   │   ├── functions/
│   │   │   └── solana-pay-verify/   # Edge Function: payment verification
│   │   └── config.toml
│   └── tauri.conf.json
│
├── package.json                     # Root scripts
└── README.md
```

---

## Local Development

### Prerequisites

- Node.js 20+
- npm
- A [hosted Supabase project](https://supabase.com/dashboard)
- Rust toolchain (only for Tauri desktop or WASM builds)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Environment

Create `frontend/.env` (see `frontend/.env.example`):

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Database

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

SQL schema is in `backend/supabase/sql/`.

### WASM Build (browser geometry engine)

```bash
cd backend/crates
bash build-wasm.sh
```

### Desktop Build (Tauri)

```bash
cd backend
cargo tauri dev
```

---

## Quality Checks

```bash
cd frontend
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run test       # Vitest
npm run build      # Production bundle
```

---

## Key Design Decisions

- **Hybrid on-chain / off-chain storage** — surveying handles sensitive, legally significant data, so users choose per file what to anchor to Solana (tamper-evident, immutable, verifiable) versus what to keep in affordable Supabase storage. Security where it matters, low cost everywhere else.
- **Wallet-native economics** — the user's own Solana wallet pays the network gas fees for on-chain operations, keeping the platform's running costs predictable and the user in control of their data and spend.
- **Web 3.0 by default** — Solana on-chain payments and file anchoring are first-class features, not afterthoughts
- **No custom backend** — all server logic is Supabase (PostgreSQL + RLS + Edge Functions)
- **One geometry engine, two runtimes** — the same Rust code runs as WASM in the browser and over Tauri IPC on desktop, guaranteeing identical results
- **Multi-tenancy via RLS** — every table carries a `workspace_id`; Row-Level Security enforces tenant isolation
- **Feature gating** — the CAD workspace is a paid add-on managed through a marketplace with request/approval
