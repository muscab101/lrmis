import "server-only";

/**
 * What the assistants know about LRMIS. The model answers "how does it work / how do I" questions from these
 * guides only, so keep them in step with the system when pages or workflows change.
 */

export const SYSTEM_OVERVIEW = `
LRMIS (Land Registry & Revenue Management Information System) is the land register and property tax system of the
Banadir Regional Administration (Mogadishu). It records who owns which land, measures it, values it, bills the
yearly property tax and fees, collects the money at district cashiers and online, issues title certificates and
property ID cards, and handles transfers, disputes and permits.

Places: Region → District (e.g. Hodan, Wadajir, Karaan) → Section → Sector → Neighbourhood → Street. Every parcel
sits in a neighbourhood. Staff are given one or more districts (or all districts) and only see land, owners, bills
and figures for those districts. Cashiers are also tied to one cash desk (point of sale) and only see that desk.

Key words:
- PUN: the parcel's unique number, given when the land is registered (e.g. 34KRWJXL0107).
- Partial registration: land that has been added but is not registered yet (draft, surveyed or verified).
- Registered: land with a PUN on the official register.
- Account number: given with the PUN; bills are raised against it.
- Assessment: the yearly property tax worked out for a parcel.
`.trim();

export const STAFF_GUIDE = `
THE MENU (staff only see the pages their role allows):
Overview: Dashboard (today's figures and work waiting for you), Map.
Land: Yet to register, Surveys, Owners, Parcels.
Revenue: Valuation, Billing runs, Invoices, Payments, Collections, Cashier, Points of sale, Accounting.
Legal & documents: Transfers, Disputes, Permits, Certificates, ID cards.
Insight: Reports, AI assistant, Messages, Locations.
Administration: Users, Roles, Permissions, Login history, Audit log, Settings, System health.

HOW LAND GETS REGISTERED (start to finish):
1. Yet to register shows neighbourhoods with land not registered yet ("Waiting") and neighbourhoods where nothing is
   registered ("Not started"). A supervisor picks a neighbourhood and gives it to a surveyor as a zone (Zones tab).
2. The surveyor opens Surveys → Zones, presses Open on their zone, and inside the zone uses Add owner and Add land for
   each house. When the zone is finished they press Mark done (or Cancel). Land already added stays in Parcels.
3. New land appears under Parcels → Partial registration; new owners under Owners → Partial (draft).
4. On Parcels → Partial registration each row has actions: View, Edit, Register, Delete. Inside View there is
   "Check if it exists": a surveyor of the district (the least busy) is sent to confirm the house is really there.
   Land marked not found can't be registered until it is checked again and found.
5. The Registrar (or a Land officer) presses Register. It gives the land its PUN and account number, raises its tax bill and service charge, and moves its owners to
   the register too. The district's cashiers are told the land owes money.
6. The cashier collects the payment. When the bills are paid in full the system approves the land by itself: the
   title certificate and the owners' ID cards are issued, and the registrar and print officers are notified.
7. Print officers print them from Certificates (print queue) and ID cards.

PARCELS PAGE: two tabs, Partial registration and Registered. Inside Registered there is a filter All / Paid / Not paid.
Columns: Date created, PUN, Invoice, Neighbourhood, House no, Owner, Status (Registered plus Paid or "$X owing").
Surveyors and data entry clerks add land; the Registrar registers it. Only people with "See registered land" see the Registered tab; only admins can delete registered land (and land with
money paid can't be deleted at all). Locking a parcel (e.g. for a court case) stops all changes; bills still work.
Edit changes office details only; boundary and owners change through a data correction or a transfer.

OWNERS PAGE: Partial and Registered tabs, like Parcels. Check name, ID document and phone before registering an owner
(registering needs an ID document or a phone number). One person, one record: the form warns about duplicates.
An owner who still holds land can't be deleted. Only admins delete registered owners. Owners can have a photo.

SURVEYS: survey tasks (measure the plot, draw the boundary by walking the corners with GPS or clicking the map,
submit). Boundaries that overlap neighbours go to a GIS officer for overlap review. Tabs include Open, Zones and
Site checks (the "check if it exists" visits).

VALUATION: property grades (house types) with a yearly price per m², neighbourhood rates, assessments, exemptions
(mosques, schools, hardship — a second officer approves) and appeals. A house's tax = its area in m² × the price of its
grade; without a neighbourhood rate the default rate from Settings is used. A whole neighbourhood can be assessed at once.

BILLING RUNS: bill a year's property tax (or another recurring fee) for chosen districts: start a run → preview with
counts, totals and exceptions → submit → finance approves (you can't approve your own run) → generate invoices
(owners get an SMS; already-billed parcels are skipped). One-off fees (certificate, reprint) are billed from a parcel.

INVOICES: corrections are made with a credit note (a second person decides). Only invoices with no payments can be
cancelled. Payment plans split a debt into monthly instalments and stop late penalties.

CASHIER: open a shift at your desk, take payments (cash, EVC Plus, eDahab, ZAAD, bank transfer, card), print the
receipt, and close the shift with a cash count. "To collect" lists registered land in your desk's district that still
owes money. Wrong amounts can't be edited: request a reversal and take the payment again.

COLLECTIONS (finance): check every payment against the cash count or the wallet/bank statement (Verify or Dispute),
attach evidence (photo/PDF of receipt or SMS), find duplicates, request corrections (a Finance Manager approves),
and reconcile each day (finance officer prepares, Finance Manager approves; then payments can't be corrected).

ACCOUNTING: a double-entry ledger posted automatically from invoices and payments.

TRANSFERS (ownership changes by sale, gift, inheritance or court order): search the PUN, open the parcel's Legal card,
start a transfer (declared value, new owners with shares adding to 100 %), submit — this raises the stamp duty
invoice and locks the record. Once the duty is paid a second officer approves. The Legal card also holds liens, court
orders, change of use, merge/subdivide, data corrections, boundary corrections and permit applications.

DISPUTES: an open dispute blocks transfers, subdivision and certificates until closed. The person who recorded an item
can't close it. PERMITS: applied for from the Legal card; a permit can only be approved once its fee is paid.

CERTIFICATES and ID CARDS: issue, print, reprint (with a reason and a reprint fee, then a second officer approves; the new
document gets a new serial) and cancel. Anyone can verify a certificate with its 12-character code.

REPORTS: figures for your districts, filtered by District → Section → Sector → Neighbourhood, chosen from a dropdown;
download as PDF or Excel. MESSAGES: SMS/WhatsApp sent to owners. LOCATIONS: districts, sections, sectors,
neighbourhoods, streets and their boundaries.

ADMINISTRATION: Users (create staff, give roles and districts, set a cashier's desk), Roles and Permissions (each role
is a set of permissions; a user can hold several roles), Login history, Audit log (who changed what — can't be edited),
Settings, System health.

GENERAL RULES: almost every approval needs a second person (you can't approve your own work). Every delete asks for a
reason and stays in the history. If a button is missing, your role doesn't have that permission — ask an administrator.
`.trim();

export const ADMIN_GUIDE = `
ROLES IN THE SYSTEM and what each is for: Registrar (registers land and owners), Land officer, Surveyor (zones, site
checks, boundaries), GIS officer (map, overlap review), Front desk clerk, Data entry clerk, Valuation officer,
Billing officer, Cashier (one desk), Revenue collector, Auditor (read-only finance), Accountant, Finance manager
(approves runs, corrections, reconciliations), Legal officer, Planning officer (permits), Inspector, Print officer
(certificates and ID cards), Customer service, Executive (reports), IT support, Admin, Citizen.

HOW DISTRICTS WORK: each staff member is given districts (or all districts). Their lists, reports and the assistant's
figures only cover those districts. Each district has cash desks (points of sale); a cashier is tied to one desk and
"To collect" follows the desk's district. Registered land that owes money is sent to the cashiers of its district.

BENEFITS OF THE SYSTEM (use when asked why it matters or to explain it to leaders):
- One official register: every parcel has a PUN, a boundary on the map and its owners — fewer double sales and
  land disputes.
- More revenue: every registered house is assessed and billed every year; Not paid lists and arrears reports show
  exactly who owes, by district and neighbourhood.
- Transparency and less fraud: every payment has a receipt and a reference, duplicates are detected, each day is
  reconciled against cash and wallet statements, and the audit log keeps every change.
- Second-person approval on money and ownership changes.
- Easy payment for citizens: mobile money (EVC Plus, ZAAD, eDahab), bank, card or a district cashier; SMS bills.
- Faster services: certificates and ID cards are issued automatically when the bills are paid.
- Data for planning: reports by district, section, sector and neighbourhood; Yet to register shows where surveyors go next.
`.trim();

export const CITIZEN_GUIDE = `
THE CITIZEN PORTAL: Home (your land, what you owe, receipts, messages), Bills & pay (every bill; pay with mobile money),
Track (the state of your houses and whether the title is issued), and each land's own page (details, bills, documents).
You can't apply online: registration is done by the district office and its surveyors.

How it works for you: your land is registered by the district office → it gets a PUN → its tax bill is raised → you
pay (EVC Plus, ZAAD, eDahab or Sahal with your PUN as the reference, at a district cashier, or online on Bills & pay) →
once everything is paid the title certificate and your ID card are issued automatically → collect them at the district
office. Late payment can bring penalties; ask the district office about a payment plan if you can't pay at once.
A certificate can be checked by anyone with its 12-character verification code.
`.trim();
