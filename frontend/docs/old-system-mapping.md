# Old LRMIS → new LRMIS: how each step maps

How the live (old) system's workflow is done in the new system, stage by stage. "✓" means it works today; "Gap" means it isn't built yet.

| Stage | Old system | New system | Status |
| --- | --- | --- | --- |
| 0 Setup | Location / Accounts / User Settings | `/locations`, `/valuation` (fee types, grades, rates), `/accounting`, `/payments?tab=providers`, `/admin/users`, `/admin/roles` | ✓ |
| 1 Owner | Partial Registration → Masuulka Dhulka → Add New (search first) | `/owners` (search by name, phone or ID, duplicate warning) → New owner. Next of kin, mother's name, ID, phone included | ✓ |
| 2 Land | "+" next to the owner / Land Parcels | `/applications/new` (office channel): district → neighbourhood → **pin (GPS or map)** → plot, deed, file no., **width × length** → owners and shares → documents | ✓ |
| 2 Location (new) | — | GPS keeps reading until ±15 m or better (or the user stops it); a pin clicked or dragged is saved as "moved by hand"; worse than 15 m warns and flags "low accuracy"; outside the district or neighbourhood is refused; another parcel or application within 10 m is warned; no connection keeps the entry on the device and sends it when back online; who and when are recorded; staff need **Capture location** | ✓ |
| 2 Boundary (new) | — | Drawn or walked corner by corner in the **survey** step (`/surveys/[id]`), with area and perimeter; compared with width × length (warns above 20 %) | ✓ |
| 2 Identifiers | PUN `P637015`, House No, Lambarka Xisaabta, invoice ref | PUN `BN-HDN-T01-000001` and account no. given **at registration** (after survey and notice); invoices `INV-YYYY-NNNNNN` | ✓ (House No not kept: open question) |
| 2 Registration invoice | Created on save, Unsettled | Application fee invoice raised on submit; the application waits at "Awaiting payment" | ✓ |
| 3 Fix / bulk load | Data Correction, Excel Import | Before registration: edit the application. After: parcel **Legal card → Data correction** (fields) or **Correct the boundary**, both approved by a second officer and logged. Bulk: `pnpm import-legacy` (CSV, dry run first) | ✓ |
| 4 Complete registration | ✓ icon → Registered | Survey → land officer check → 14-day public notice → registrar registers (maker-checker, fee must be paid, a survey polygon is required) | ✓ (stricter than the old system) |
| 5 Valuation, billing | Billing Section: single invoice or batch → approve → print | `/valuation` (grade × neighbourhood rate), `/billing/runs` (create → preview → submit → approve → issue), single invoice from the parcel page | ✓ |
| 6 Payment | Collections, shifts, Accounts Receivable | `/cashier` (open shift with float → take payment → close with count), `/payments`, `/invoices` (ageing in `/reports?r=arrears`), online mobile money and card | ✓ |
| 7 Accounting | GL accounts, journals | Every invoice, payment, refund and reversal posts to the ledger; `/accounting` trial balance; `/reports?r=income` | ✓ |
| 8 Notify | SMS templates, single and bulk SMS, SMS log | `/messages` (outbox = log, templates, campaigns approved by a second person), automatic receipts and status SMS, USSD, WhatsApp | ✓ |
| 9 Certificate | Registered → Enable Printing; Certificates (batches, printers) | `/documents/print`: eligible (registered + paid + no dispute) → issue → print once (logged) → reprint with fee and approval. Certificate has PUN, QR code and parcel map | ✓ (no separate "enable printing" step; eligibility decides) |
| 10 Later changes | Land Transfer, etc. | `/transfers`, `/disputes` (liens, court orders, parcel changes), `/permits`, subdivision and merge, data correction; all with a second approver and the audit log | ✓ |

## Differences from the old system

- **Registration is stricter.** A parcel only gets its PUN after a survey boundary, checks and a public notice. Records loaded from the old register come in as draft applications and follow that path.
- **No "Enable Printing" switch.** A certificate can be issued as soon as the parcel is registered, fully paid and not disputed.
- **House No** from the old system isn't stored yet. If it is still used on the ground, it can be added as a parcel field.
- **Invoice on parcel save.** The old system appears to raise the registration invoice when the parcel is saved; the new one raises the application fee when the application is submitted.
