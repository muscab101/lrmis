import "server-only";

/**
 * What the assistants know about LRMIS. The model answers "how does it work / how do I" questions from these
 * guides only, so keep them in step with the system when pages or workflows change.
 */

export const SYSTEM_OVERVIEW = `
LRMIS (Land Registration & Management Information System) is the land register and property tax system of the
Banadir Regional Administration (Mogadishu). It records who owns which land, measures it, prices it, bills the yearly
property tax and fees, collects the money at district cash desks and online, issues title certificates and property ID
cards, and handles transfers and demolitions. It works in Somali and English.

Places: Region → District (20 districts, e.g. Hodan, Wadajir, Kaaraan) → Section → Sector → Neighbourhood. Every
parcel sits in a neighbourhood and has a house number there (e.g. KRWJXL01 12). Staff are given one or more districts
(or all) and only see land, owners, bills and figures for those districts.

Key words:
- PUN: the parcel's unique number, given when the land is registered.
- Partial registration: land added but not registered yet (draft, surveyed or verified).
- Registered: land with a PUN on the official register.
- Account number: given with the PUN; bills are raised against it.
- Tax anniversary: the day each year a registered property gets its new tax bill and its certificate ends.
- Powers: what a person may do. Roles give powers; a single user can get an extra power or lose one.
`.trim();

export const STAFF_GUIDE = `
THE MENU (each person only sees the pages their powers allow):
Overview: Dashboard, Map, Incomplete, Applications, Staff chat.
Land: Yet to register, Surveys, Owners (tabs: Partial registration, Registered, Managers), Parcels (tabs: Partial
registration, Registered, Apartments), Demolished.
Revenue: Valuation, Billing runs, Invoices, Payments, Collections, Cashier, Points of sale, Accounting.
Legal & documents: Transfers, Certificates, ID cards, Verify, Add printer.
Insight: Reports, Assistant, Messages, Locations.
Administration: Users, Roles, Activity, Login history, Audit, Signature and stamp, Settings, Health.

DAILY PAGES:
- Dashboard: today's figures for your districts, by your job.
- Incomplete: everything still unfinished (owners in draft, land yet to register, open zones), each with a link.
- Applications: requests waiting for a decision (land changes, demolitions, transfers, certificates, accounting,
  messages), one tab per kind. Approvals need a second person: nobody approves their own work.
- Staff chat: one-to-one and group chat with photos and videos. Assistant: this assistant.

ADDING LAND (Surveys → a zone → Add owner / Add land, or from an owner's page):
1. Enter the plot's width and length (the whole plot), the house type and the use.
2. Choose the kind:
   - Normal house: bill = plot m² × the house type's price.
   - Flats building: the storeys, then each flat with its floor, width × length (its m² is worked out) and its owner.
     The owner entered first becomes the building's MANAGER. Billing: a ground-floor flat × the "Apartment" price,
     a flat on floor 1, 2, 3 … × the "Upper Floors" price; the rest of the plot (plot − all flats' m²) × the
     "Empty Land" price, paid by the manager. Extra areas (parking, playgrounds) can be added later on the building's
     page, each at its own price per m², also paid by the manager.
   - Shared compound: several houses on one plot; shared spaces are named and the shared m² is split equally or by size.
3. Prices come from Valuation → House types; a neighbourhood's own prices (Valuation → Rates) win where set.
4. The first bills (property bill + service charge) are made at once. When EVERY bill of partial land is paid, the
   land registers by itself: it gets its PUN, its owners are registered and its certificate is issued. There is no
   separate Register button or approval for this.
Changing a flat's size or floor re-bills the building straight away; bills already paid are never lowered.
Names take letters only and number boxes take digits only.

PARCELS: tabs Partial registration, Registered and Apartments. Inside Registered: All / Paid / Not paid / Demolished.
A property's page shows owners, bills, documents, history, the map, the next tax bill date and (for flats) the manager
and extra areas. Locking a property (e.g. for a court case) stops changes; bills still work. Demolished land is kept
as an archive (Demolished page: Archive, Pending, Closed) and can be registered again after rebuilding.
Apartments tab: every flats building or compound with its flats, how many are registered and what it owes; a
building's page lists its flats floor by floor.

OWNERS: tabs Partial registration, Registered and Managers (building managers with the buildings they pay for). One
person, one record: the form warns about duplicates. An owner who still holds land can't be deleted.

VALUATION (6 tabs): Price check (work out a bill), Rates (a neighbourhood's own price per house type; edit or remove
them), House types (Apartment, Upper Floors, Empty Land, Villa, …, each with a price per m²), Fee types, Transfer types
(the choices on the transfer form, each with its stamp duty; switch them on or off here), Owner types.

BILLING (automatic every year):
- Each registered property has a tax anniversary (its first certificate day). Every day at 03:00 the system finds the
  properties whose anniversary has come: their certificate ends and the year's tax bill is made, due in 60 days, and
  the owner gets an SMS. When it is paid in full, a new certificate is issued by itself, valid to the next anniversary.
- Billing runs: the automatic runs appear here. "Missed yearly bills" lists land the automatic billing skipped; tick
  them to make runs. A run can also be made by hand; it is checked, approved by a second person and issued.
  List rows only offer View, Issue now (when the run has bills) and Cancel; the rest is on the run's own page.
- There is no early-payment discount (the setting is 0%).
INVOICES: columns Transaction date, Date due, PUN, Account number, Phone, Invoice number, Amount, Status. Print sends
the bill to a printer you choose. Corrections use a credit note; only bills with no payments can be cancelled.

CASHIER: the shift opens by itself when you have one desk (with several desks you pick one). Find the bill by PUN,
invoice or application number, then:
- Cash: enter the amount and press Take payment.
- Mobile money (EVC Plus, ZAAD, eDahab, Sahal): check the payer's phone and press "Send payment request". The bill's
  amount appears on their phone; they approve with their PIN and the receipt is recorded by itself. If they already
  paid by SMS, press "Paid already? Type the reference" and take it by hand.
- Bank transfer or cheque: with its reference.
Print the receipt to a printer you choose (no new tab). Close the shift at the end of the day with the cash count.
Each district has one office cash desk (Points of sale). Wrong amounts can't be edited: request a reversal.
PAYMENTS: tabs Payments, Unmatched, Reversals, Shifts, Providers. Providers holds the city's bank account shown to
citizens for transfers. COLLECTIONS: verify each payment against the wallet or bank statement, evidence, duplicates,
corrections and daily reconciliation. ACCOUNTING: the double-entry books, posted automatically.

TRANSFERS (sale, gift, inheritance, court order — the types come from Valuation → Transfer types): open the
property's Legal card, start a transfer with the new owners, submit (the stamp duty bill is made and the record is
locked); once the duty is paid a second officer approves.

CERTIFICATES and ID CARDS: issued by themselves when land registers and every year after the tax is paid. Print sends
them to a registered desk printer you choose (Add printer sets printers up per district). A reprint needs a reason,
a reprint fee and a second officer. VERIFY: type the 12-character code or scan the QR; the answer pops up: Valid,
Expired or Cancelled, with the property and owners.

REPORTS: 24 reports in 6 groups (Daily collections and cash; Bills and income; Land and field work; Transfers;
Certificates; Staff and messages), filtered by place and dates, downloaded as PDF or Excel. MESSAGES: SMS and
WhatsApp to owners. LOCATIONS: districts, sections, sectors and neighbourhoods with their boundaries.

ADMINISTRATION: Users (roles, districts, a cashier's desk, and a Powers tab to give or take single powers),
Roles (the powers grid: Dashboard, Incomplete, Map, Applications, Parcels, Apartments, Owners, Managers, Surveys,
Valuation, Billing, Invoices, Payments, Cashier, Points of sale, Collections, Accounting, Transfers, Certificates,
Verify, Messages, Staff chat, Reports, Assistant, Locations, Settings, Audit, Users, Roles), Activity (recorded work
sessions, live view), Login history, Audit (every change, can't be edited), Signature and stamp, Settings, Health.
Staff sign in with email, password and a two-step code from an authenticator app.

GENERAL RULES: approvals need a second person. Every delete asks for a reason and stays in the history. If a button is
missing, your powers don't include it — ask an administrator.
`.trim();

export const ADMIN_GUIDE = `
ROLES IN THE SYSTEM (24): Super Admin, Admin, Registrar / District Manager, Land Officer, Surveyor, GIS Officer,
Front-desk Clerk, Data Entry Clerk, Valuation Officer, Billing Officer, Cashier / Collector, Revenue / Tax Collector,
Collections Officer, Accountant, Finance Manager, Auditor, Legal Officer, Planning Officer, Inspector, Print Officer,
Customer Service, Director / Governor, IT Support, Citizen. Each role is a set of powers (233 in all); a user can get an
extra power or lose one on their own Powers tab without changing the role.

HOW DISTRICTS WORK: each staff member covers chosen districts (or all). Their lists, reports and the assistant's
figures only cover those districts. Each district has one office cash desk; a cashier with one desk works there.

WHAT IS STILL NEEDED TO GO LIVE: WaafiPay keys (mobile money to real phones), an SMS provider, the city's bank account
(Payments → Providers) and the card webhook secret, desk printers for the districts without one, and leaked-password
protection switched on.

BENEFITS OF THE SYSTEM (use when asked why it matters or to explain it to leaders):
- One official register: every parcel has a PUN, a boundary on the map and its owners — fewer double sales and disputes.
- More revenue: every registered property is billed on its own anniversary each year, automatically; Missed yearly
  bills catches any that slipped; Not paid lists and arrears reports show exactly who owes.
- Fair apartment billing: each flat pays by its floor, and the building's manager pays for the open land.
- Transparency and less fraud: every payment has a receipt and a reference, duplicates are detected, each day is
  reconciled against cash and wallet statements, and the audit log keeps every change.
- Second-person approval on money and ownership changes.
- Easy payment: mobile money request to the payer's phone, card, bank transfer or a district cash desk.
- Faster services: land registers itself and certificates are issued automatically once the bills are paid; anyone can
  check a certificate by its QR code.
- Data for planning: reports by district, section, sector and neighbourhood; Yet to register shows where to survey next.
`.trim();

export const CITIZEN_GUIDE = `
WHO CAN USE THE PORTAL: owners whose phone is on the land register and who hold land. You sign in with your phone and a
6-digit SMS code — there is no password. A phone that is not registered with land is asked to register first at the
district's LRMIS office.

THE PORTAL: My land (each property with its house number, what is owed, the next tax bill date, your receipts and
messages), Bills (every bill: tick the ones to pay and pay them together, or one by one), Track (where each property
stands), Verify (check a certificate, when your role allows) and Assistant. Each property has its own page with bills,
documents and receipts; each receipt can be opened and printed.

HOW TO PAY: on Bills or a property's page press Pay. Choose mobile money (EVC Plus, ZAAD, Sahal or eDahab — approve the
request on your phone with your PIN), card, or bank transfer (the city's bank details are shown; write your PUN as the
reference). Paying several bills together makes one payment, and each bill gets its own receipt.

HOW IT WORKS FOR YOU: the district office registers your land → its bills are made → you pay → when everything is paid
your land registers by itself (it gets its PUN) and your certificate is issued → every year on your property's
anniversary a new tax bill comes; once it is paid a new certificate is issued. Anyone can check a certificate with its
QR code or 12-character code on the Verify page.
`.trim();
