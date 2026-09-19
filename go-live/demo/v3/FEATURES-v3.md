# FEATURES.md · the 27 screens of demo v3

Add these blocks to the project's `FEATURES.md`, under everything already there. They are in the shape the project already keeps, with three extra lines. **Do not change or remove the `Screen`, `Register` and `File` lines:** they are how each drawing is matched to the work it belongs to when the package comes back. Fill in `Added` with the date a screen is built. Change `What it does` only if the screen ends up doing something different, and say so in `CHANGELOG.md`.

## A · The community's HOAhx subscription

### A1 · Plans and prices
- Screen: A1
- Register: D-059
- File: app/v3/a1-plans-and-prices.tsx
- Where: Board & manager › HOAhx subscription
- Who: board, manager
- What it does: Shows the plans by number of homes, which one this community falls in, the monthly and annual price, and what paying annually saves; the board chooses a plan.
- In the app now: no. HOAhx staff can set plans up behind the scenes; a board has nowhere to see or choose one.
- Added: 

### A2 · The free trial, and starting the subscription
- Screen: A2
- Register: D-174
- File: app/v3/a2-the-free-trial-and-starting-the-subscrip.tsx
- Where: Board & manager › HOAhx subscription
- Who: board, manager
- What it does: Shows the days left in a 30-day trial that asks for no payment details, then takes the board through accepting the terms, adding a bank account or card, and a confirmation with the receipt and renewal date.
- In the app now: no. Being built for launch; nothing starts or ends a trial yet.
- Added: 

### A3 · Billing home: plan, next charge, invoices
- Screen: A3
- Register: D-174
- File: app/v3/a3-billing-home-plan-next-charge-invoices.tsx
- Where: Board & manager › HOAhx subscription
- Who: board, manager
- What it does: Shows the current plan, the next charge and its date, the payment method on file, every invoice with its status, and renewal notices; a board member who is not a billing contact sees a view-only version.
- In the app now: partly. A subscription screen exists on the earlier payment path; invoices and renewal notices are being built for launch.
- Added: 

### A4 · Billing contacts, and handing over the account
- Screen: A4
- Register: D-061
- File: app/v3/a4-billing-contacts-and-handing-over-the-ac.tsx
- Where: Board & manager › HOAhx subscription
- Who: board, manager
- What it does: Shows the Account Owner, the backups and any Billing Administrator with what each may do, and lets the Account Owner add or remove contacts or hand the role to someone who then accepts it.
- In the app now: no. Being built for launch; today anyone with the subscription permission can act.
- Added: 

### A5 · When a payment has not gone through
- Screen: A5
- Register: D-060
- File: app/v3/a5-when-a-payment-has-not-gone-through.tsx
- Where: Board & manager › HOAhx subscription, plus a banner on every board screen
- Who: board, manager
- What it does: Shows a banner with the amount owed, the date of the next change and what it will be, the full day 1, 16, 30, 60, 90 schedule with today marked, and Pay balance and Update payment method at every stage; residents are never affected.
- In the app now: no. Both states are recorded today but nothing sends a notice or restricts anything.
- Added: 

### A6 · Cancelling, and taking the records along
- Screen: A6
- Register: D-176
- File: app/v3/a6-cancelling-and-taking-the-records-along.tsx
- Where: Board & manager › HOAhx subscription
- Who: board, manager
- What it does: Explains what cancelling means and when it takes effect, what is kept and for how long, and lets the Account Owner request and download the community data export, cancel, or come back later.
- In the app now: no. A community can be archived by HOAhx staff; there is no export and no cancellation screen.
- Added: 

### A7 · The HOAhx staff side: extend, restore, make an exception
- Screen: A7
- Register: D-175
- File: app/v3/a7-the-hoahx-staff-side-extend-restore-make.tsx
- Where: Role center › HOAhx Platform Admin
- Who: HOAhx staff
- What it does: Lists every community subscription with plan, status, renewal and days past due, and lets staff extend a trial or grace period, mark an exception, restore access or move the Account Owner, each with a written reason that is logged.
- In the app now: partly. Staff have billing account and profile screens; extensions, exceptions and manual restore with a reason do not exist.
- Added: 

## B · Approvals and sensitive actions

### B1 · Asking for a refund
- Screen: B1
- Register: D-042
- File: app/v3/b1-asking-for-a-refund.tsx
- Where: Payments, board side
- Who: board, manager
- What it does: The financial user picks a payment, sees whether it has settled and the most that can be refunded, enters an amount and a reason, signs in again and sends it for approval; an unsettled payment is voided instead.
- In the app now: partly. A treasurer can refund alone with a reason today; the two-person request is being built for launch.
- Added: 

### B2 · Approvals waiting for me
- Screen: B2
- Register: D-042
- File: app/v3/b2-approvals-waiting-for-me.tsx
- Where: Board & manager
- Who: board, manager
- What it does: Lists every request waiting on this Financial Approver with who asked, the amount, the reason and the time left of 48 hours, and lets them sign in again and approve or decline with a note.
- In the app now: no. Being built for launch.
- Added: 

### B3 · The approval record
- Screen: B3
- Register: D-190
- File: app/v3/b3-the-approval-record.tsx
- Where: Opens from any ledger entry
- Who: board, manager, owner
- What it does: Shows who asked, when and why, who approved and when, that both signed in again, the amount, where the money went back to and the matching ledger entry; nothing on it can be edited; the homeowner gets a refund receipt.
- In the app now: partly. The audit log records who performed an action; an approval is not recorded as its own record.
- Added: 

### B4 · Who may do what
- Screen: B4
- Register: D-189
- File: app/v3/b4-who-may-do-what.tsx
- Where: Role center
- Who: board, manager
- What it does: Shows each role against the eight kinds of action (view, edit, approve, publish, refund, export, grant access, archive) and lets an authorised person take a permission away from one person with a reason; nobody can change their own.
- In the app now: partly. A permissions screen exists and a permission can be removed from one person; it is not laid out by the eight kinds of action.
- Added: 

### B5 · Exporting a list safely
- Screen: B5
- Register: D-190
- File: app/v3/b5-exporting-a-list-safely.tsx
- Where: Every list with an Export button
- Who: board, manager
- What it does: Before anything downloads, shows what the file will contain, what has been left out and why (private details, how anyone voted) and how many records, and asks for a reason.
- In the app now: partly. Exports exist and follow the role; nothing shows what is left out and no reason is asked for.
- Added: 

### B6 · Naming the two Financial Approvers
- Screen: B6
- Register: D-042
- File: app/v3/b6-naming-the-two-financial-approvers.tsx
- Where: Community onboarding › roles and permissions
- Who: board, manager
- What it does: A setup step that explains why two approvers are needed, shows who is eligible, and holds online payments back until at least two people are chosen.
- In the app now: no. Planned; the setup wizard has no such step.
- Added: 

## C · Falling behind, payment plans, the ledger and statements

### C1 · Who is behind
- Screen: C1
- Register: D-123
- File: app/v3/c1-who-is-behind.tsx
- Where: Board & manager
- Who: board, manager
- What it does: Lists every home with an overdue balance: the amount, how long overdue, the case status, who is following it up and the last thing sent, with filters and a notice to several homes at once.
- In the app now: partly. A delinquency report groups balances by 30, 60 and 90 days; there is no case status and no named person.
- Added: 

### C2 · One household's case
- Screen: C2
- Register: D-123
- File: app/v3/c2-one-household-s-case.tsx
- Where: Opens from Who is behind
- Who: board, manager
- What it does: Shows how the balance built up, every notice with its date and whether it arrived, the status, the named owner of the case and the next step with its date; from here the board sends the next notice, offers a payment plan or waives a fee.
- In the app now: partly. A case can be escalated through to a lien; there is no notice history and no collections status.
- Added: 

### C3 · "I am behind": the homeowner's view
- Screen: C3
- Register: D-123
- File: app/v3/c3-i-am-behind-the-homeowner-s-view.tsx
- Where: Payments
- Who: owner, renter
- What it does: Shows what is owed and what it is made of, the date that matters and what happens then, the choices available (pay now, pay part, ask for a payment plan) and a named person to talk to, in calm and neutral wording.
- In the app now: partly. The homeowner sees the balance and any late fee; there is no deadline, no list of choices and no contact.
- Added: 

### C4 · Setting up a payment plan
- Screen: C4
- Register: D-124
- File: app/v3/c4-setting-up-a-payment-plan.tsx
- Where: Opens from the household's case
- Who: board, manager, owner
- What it does: The treasurer proposes a schedule of payments, a second person approves it, and the homeowner accepts it; the screen says whether late fees pause while the plan is kept.
- In the app now: no. There are no payment plans.
- Added: 

### C5 · A payment plan in progress
- Screen: C5
- Register: D-124
- File: app/v3/c5-a-payment-plan-in-progress.tsx
- Where: Payments, and the household's case
- Who: owner, board, manager
- What it does: Reads as a plan rather than a moving balance: four of nine paid, the next payment and its date, what remains, a missed installment flagged with what happens now.
- In the app now: no. There are no payment plans.
- Added: 

### C6 · Waiving a fee or adjusting a balance
- Screen: C6
- Register: D-124
- File: app/v3/c6-waiving-a-fee-or-adjusting-a-balance.tsx
- Where: Opens from the household's case or the ledger
- Who: board, manager
- What it does: One person asks to waive a fee or adjust a balance with a reason, a second person approves or declines, and the result appears in the homeowner's ledger with its approval record.
- In the app now: partly. Credits and adjustments can be posted with a short description; no approval is recorded.
- Added: 

### C7 · A ledger you can follow
- Screen: C7
- Register: D-121
- File: app/v3/c7-a-ledger-you-can-follow.tsx
- Where: Payments, and Properties
- Who: owner, renter, board, manager
- What it does: Every entry with its date, its kind and the running balance beside it; nothing is ever edited, so a correction is a new entry that names the one it corrects; any entry opens to show where it came from.
- In the app now: partly. The ledger records every kind of entry and posts refunds and returned payments as their own entries; a correction does not point at what it corrects, and opening balances are typed in by hand.
- Added: 

### C8 · Statements, exports, and matching deposits
- Screen: C8
- Register: D-122
- File: app/v3/c8-statements-exports-and-matching-deposits.tsx
- Where: Board & manager
- Who: board, manager
- What it does: A statement per home and a collection summary marked with the period covered, bank deposits that open to show the payments inside them with a clear mark where a deposit and the ledger disagree, and an export a bookkeeper can use.
- In the app now: partly. Monthly summaries, a ledger report and payment exports exist; matching deposits is being built for launch.
- Added: 

## D · Bringing a community in

### D1 · Upload the spreadsheet and match the columns
- Screen: D1
- Register: D-172
- File: app/v3/d1-upload-the-spreadsheet-and-match-the-col.tsx
- Where: Community onboarding › property and owner import
- Who: board, manager
- What it does: The administrator uploads the community's own CSV or Excel file, sees which HOAhx field each column was matched to and how sure the match is, and confirms or corrects every one.
- In the app now: partly. HOAhx staff can import a spreadsheet with fixed columns; a board has no import and there is no matching of columns.
- Added: 

### D2 · Check it before it goes in
- Screen: D2
- Register: D-172
- File: app/v3/d2-check-it-before-it-goes-in.tsx
- Where: Community onboarding › property and owner import
- Who: board, manager
- What it does: Counts the rows that are ready, that need a decision and that cannot go in, and treats a duplicate, a missing detail and a value that only looks wrong as three different things; only a blocked row stops the import.
- In the app now: partly. The staff import previews each row with its errors and flags duplicates inside the file.
- Added: 

### D3 · Opening balances: the treasurer signs off
- Screen: D3
- Register: D-172
- File: app/v3/d3-opening-balances-the-treasurer-signs-off.tsx
- Where: Community onboarding › property and owner import
- Who: board, manager
- What it does: Shows the total of all opening balances beside the figure the treasurer expected; nothing is saved until the treasurer, who may be a different person on a different day, approves the total.
- In the app now: no. Opening balances are typed in by hand as a charge or an adjustment.
- Added: 

### D4 · What past imports did, and fixing one
- Screen: D4
- Register: D-172
- File: app/v3/d4-what-past-imports-did-and-fixing-one.tsx
- Where: Community onboarding › property and owner import
- Who: board, manager
- What it does: Lists each import with its date, who ran it and what it added or changed, opens one to see exactly what it did, and corrects a mistake with the correction on record.
- In the app now: no. No import history is kept.
- Added: 

### D5 · Who has joined
- Screen: D5
- Register: D-173
- File: app/v3/d5-who-has-joined.tsx
- Where: Community onboarding › invitation review
- Who: board, manager
- What it does: Shows every home and person against four steps (invited, joined, verified, active) with totals, whose invitation has lapsed, and sending again to one person or to everyone who has not joined.
- In the app now: partly. The board sees pending invitations on the roster; it does not see who is verified or active.
- Added: 

### D6 · Someone joined without an invitation
- Screen: D6
- Register: D-173
- File: app/v3/d6-someone-joined-without-an-invitation.tsx
- Where: Community onboarding › invitation review
- Who: board, manager, owner
- What it does: Shows the board who the person says they are, which home they claim, their proof and whether that home already has an owner; shows the person a plain "we are checking" screen; ends with the offer of automatic payments.
- In the app now: partly. A join flow exists and matching a person to a home is by invitation only.
- Added: 
