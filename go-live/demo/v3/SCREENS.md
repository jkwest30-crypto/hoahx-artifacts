# SCREENS.md · the 27 screens of HOAhx demo v3

Four features, 27 screens. Each screen has a code (A1, B3). For each: what it Shows, what people Can do, and the states to draw. Each feature starts with Rules already decided: follow them exactly.

---

## FEATURE A · The community's HOAhx subscription (7 screens)

This is the board buying HOAhx. It is not homeowner dues. Homeowners never see any of this and never pay HOAhx. Keep it apart from dues on every screen: its own section, its own wording, never inside a resident's balance. Web only; the phone apps do not sell the subscription. New navigation section: "HOAhx subscription" under Board & manager, id `subscription`.

### Rules already decided
- Flat plans by number of homes, paid monthly or annually. Paying annually waives the implementation fee.
- A 30-day trial that asks for no payment details.
- Billing contacts: one Account Owner, at least one backup, an optional Billing Administrator.
- Payable by bank account or card.
- When a payment fails: day 1 the contacts are told and the charge retries by itself. Days 1-15 everything works and a notice shows. Day 16 officially past due. Day 30 the board side becomes read-only. Day 60 the board side is suspended. Day 90 collections, with notice and a data export offered first.
- Residents are never affected at any stage: they keep paying dues, seeing balances, reading documents.
- Warning always comes before a change. Access returns by itself once payment clears.
- HOAhx staff can extend the grace period, make an exception, or restore access by hand, each recorded with a reason.
- Prices are not final: show the September 8 draft tiers labelled "provisional".

### A1 · Plans and prices
- Where: Board & manager > HOAhx subscription
- Shows: the tiers side by side; which tier this community falls in by home count; monthly and annual price of each; what paying annually saves.
- Can do: switch monthly/annual; choose a plan; continue to A2.
- Draw these states: First look, 120 homes | Already subscribed, about to move up a tier

### A2 · The free trial, and starting the subscription
- Where: Board & manager > HOAhx subscription
- Shows: days left in the trial; what happens when it ends; the terms to accept; the plan chosen; the first charge and its date.
- Can do: accept the terms; add a bank account or card; confirm; see a confirmation with receipt and next renewal date.
- Draw these states: Trial, 22 days left | Trial, 3 days left | Trial ended, nothing chosen | Purchase confirmed

### A3 · Billing home: plan, next charge, invoices
- Where: Board & manager > HOAhx subscription
- Shows: current plan; next charge and date; payment method on file; every invoice with its status; a renewal notice when one is coming.
- Can do: open or download an invoice; change the payment method; change plan; go to A4 or A6.
- Draw these states: All paid up | Renewal due in 14 days | Card expires within three months | Viewed by a board member who is not a billing contact (view only)

### A4 · Billing contacts, and handing over the account
- Where: Board & manager > HOAhx subscription
- Shows: the Account Owner, backups and any Billing Administrator, with what each may do (buy, change plan, cancel, view only).
- Can do: add or remove a backup; name a Billing Administrator; hand the Account Owner role to someone else.
- Draw these states: Normal list | Handover waiting for acceptance | The new person's view of the request | Removing the last backup, refused with the reason

### A5 · When a payment has not gone through
- Where: Board & manager > HOAhx subscription, plus a banner on every board screen
- Shows: a banner with the amount owed, the exact date of the next change and what it will be; below it the full schedule with today marked.
- Can do: "Pay balance"; "Update payment method"; contact billing support. All three work at every stage, including suspension.
- Draw these states: Day 3, notice showing | Day 16, officially past due | Day 30, read-only (records all still there, changes paused) | Day 60, suspended (pay and support still reachable) | Payment cleared, access restored | A resident's screen on day 60, unchanged

### A6 · Cancelling, and taking the records along
- Where: Board & manager > HOAhx subscription
- Shows: what cancelling means; when it takes effect; what is kept and for how long; what is removed.
- Can do: request the community data export; download it; confirm cancellation; reactivate later.
- Draw these states: Before cancelling | Export being prepared | Export ready | Cancelled, end date showing | Coming back: reactivate

### A7 · The HOAhx staff side
- Where: Role center > HOAhx Platform Admin
- Shows: every community's subscription: plan, status, next renewal, days past due. Also one report where subscription income and homeowner dues are two separate lines, never added together.
- Can do: extend a trial or grace period; mark an exception; restore access by hand; move the Account Owner. Each asks for a written reason first.
- Draw these states: List filtered to past due | The reason step | The log entry it produced (who, when, why)

---

## FEATURE B · Approvals and sensitive actions (6 screens)

### Rules already decided
- No refund and no payment void by one person. No amount is small enough to skip this. One financial user asks; a different Financial Approver approves.
- Both people sign in again at the moment they act.
- A refund goes only to the method the payment came from, never for more than the original amount, and only once the payment has settled. Before settling, the payment is voided instead.
- A request lapses after 48 hours. Changing the amount or reason starts it again.
- A reason is always required. The same refund cannot be asked for twice.
- Nobody asks for or approves a refund on their own home, household or property.
- HOAhx staff never ask for or approve the movement of a community's money.
- Every community names at least two Financial Approvers during setup.
- The homeowner gets a refund receipt. The community's financial contacts are told.
- Eight kinds of action are permitted separately: view, edit, approve, publish, refund, export, grant access, archive. Nobody can grant or approve a permission for themselves. A change for one person can only take permissions away.
- An export leaves out private details and how anyone voted.

### B1 · Asking for a refund
- Where: Payments, board side
- Shows: the payment; amount; how it was paid; whether it has settled; the most that can be refunded; who can approve.
- Can do: enter amount and reason; sign in again; send the request. If not settled, the button reads "Void payment".
- Draw these states: Ordinary request | Amount above the original, refused | Payment on the asker's own home, refused | Second request for the same payment, refused | Waiting for approval, 48-hour clock showing

### B2 · Approvals waiting for me
- Where: Board & manager
- Shows: every request waiting on this person: who asked, amount, reason, time left.
- Can do: open one; sign in again; approve or decline with a note.
- Draw these states: Three waiting, one with two hours left | One that lapsed | One I cannot act on (I asked for it, or it is my own home) | Empty inbox

### B3 · The approval record
- Where: opens from any ledger entry
- Shows: who asked, when, why; who approved, when; that both signed in again; amount; method it went back to; the matching ledger entry. Nothing can be edited.
- Can do: open from the ledger entry; print or save.
- Draw these states: Approved refund | Declined | Lapsed | The homeowner's refund receipt

### B4 · Who may do what
- Where: Role center
- Shows: each role down the side, the eight kinds of action across the top.
- Can do: open one person and take a permission away, with a reason.
- Draw these states: The full grid | One person with a permission removed, with the note | Someone trying to change their own permissions, refused

### B5 · Exporting a list safely
- Where: every list with an Export button
- Shows: before download: what the file will contain, what is left out and why, how many records.
- Can do: give a reason; confirm; download.
- Draw these states: Resident roster, private columns listed as removed | Vote export, choices removed | A role that may not export

### B6 · Naming the two Financial Approvers
- Where: Community onboarding > roles and permissions
- Shows: why two are needed; who is eligible; who has been chosen.
- Can do: choose at least two people; continue.
- Draw these states: None chosen, online payments held back | One chosen, still held back | Two chosen, ready

---

## FEATURE C · Falling behind, payment plans, the ledger and statements (8 screens)

### Rules already decided
- Balances are grouped as current, 30, 60 and 90 days. That is a board tool. A homeowner never sees which group they are in.
- Every notice sent is kept with its date and how it was sent. Each case has a status and one named person following it up.
- The homeowner always sees the deadline, what they can do, and who to contact.
- A payment plan is approved by the board and the approval is recorded. Both sides see progress. A missed installment is flagged.
- A waived fee or adjusted balance records who approved it and why.
- Nothing in the ledger is ever edited or deleted. A correction is a new dated entry that points at the one it corrects. Refunds, returned payments and disputes are their own entries.
- Opening balances brought in from a spreadsheet are marked as imported.
- Statements always agree with the ledger. A deposit is many payments and can be opened to see them.
- Plain, neutral wording. Never "delinquent" on a homeowner's screen.

### C1 · Who is behind
- Where: Board & manager
- Shows: every home with an overdue balance: amount, how long overdue, case status, who is following up, last thing sent.
- Can do: filter by age or status; open a case; assign a person; send a notice to several homes with a confirmation naming how many.
- Draw these states: Twelve homes across the four groups | A case with nobody assigned | Empty list

### C2 · One household's case
- Where: opens from C1
- Shows: how the balance built up; every notice with date and whether it arrived; status (reminder sent, final notice, payment plan, collections); named case owner; next step and date.
- Can do: send the next notice; change status with a reason; reassign; offer a payment plan (C4); waive a fee (C6).
- Draw these states: Early case, one reminder sent | On a payment plan | About to go to collections, showing the warning already given

### C3 · "I am behind": the homeowner's view
- Where: Payments (homeowner)
- Shows: what is owed and what it is made of; the date that matters; what happens then; the choices; a named person to talk to.
- Can do: pay now; pay part; ask for a payment plan; message the named person.
- Draw these states: Two weeks late | Ninety days late, final notice | On a payment plan, up to date. No red banners.

### C4 · Setting up a payment plan
- Where: opens from C2
- Shows: the balance; proposed schedule (how many payments, how much, which dates); whether late fees pause while the plan is kept.
- Can do: treasurer proposes; a second person approves; the homeowner accepts.
- Draw these states: Proposal being written | Waiting for board approval | Approved, waiting for the homeowner | Accepted and running

### C5 · A payment plan in progress
- Where: Payments (homeowner), and C2 (board)
- Shows: reads as a plan: four of nine paid, next payment on the 15th, what remains.
- Can do: homeowner pays an installment early; board sees the same with history.
- Draw these states: On track | One installment missed, what happens now | Plan completed | Plan ended after repeated misses, what the homeowner was told

### C6 · Waiving a fee or adjusting a balance
- Where: opens from C2 or the ledger
- Shows: the fee or amount; the reason; who is asking; who must approve.
- Can do: ask; approve or decline (same two-person pattern as a refund).
- Draw these states: Late fee waived, with approval record | Request declined | How the waiver appears in the homeowner's ledger

### C7 · A ledger you can follow
- Where: Payments (homeowner), and Properties (board)
- Shows: every entry with date, kind (charge, payment, credit, adjustment, refund, returned payment, opening balance) and the running balance beside it. A correction names the entry it corrects in one plain line.
- Can do: open any entry to see where it came from, including its approval record (B3); filter by kind; download a statement.
- Draw these states: Ordinary year | A refunded payment | A returned bank payment with the return fee | An imported opening balance later corrected. Draw once as homeowner, once as board.

### C8 · Statements, exports, and matching deposits
- Where: Board & manager
- Shows: a statement per home and a community collection summary, each marked with its period; bank deposits that open to show the payments inside; a clear mark where a deposit and the ledger disagree.
- Can do: choose a period; export a bookkeeper's file; mark a deposit as matched; open the one-page note on what to carry into the accounting system.
- Draw these states: A month that matches completely | A deposit short by one payment, showing which | The bookkeeper's export with its columns visible

---

## FEATURE D · Bringing a community in (6 screens)

### Rules already decided
- The board uploads its own spreadsheet, CSV or Excel: properties, owners, occupants, opening balances.
- HOAhx suggests which column is which from the headings. A person confirms or corrects every suggestion.
- Nothing is saved until the preview has been reviewed AND the treasurer has approved the opening-balance total.
- Every import is kept on record and can be corrected afterwards.
- An invitation lasts 7 days for a resident, 72 hours for a board member or manager. Sending again cancels the earlier link.
- A person moves through four steps: invited, joined, verified, active.
- Someone who joins without an invitation is matched to a property and verified by the board before they see anything.
- When a resident finishes joining, they are offered automatic payments.

### D1 · Upload the spreadsheet and match the columns
- Where: Community onboarding > property and owner import
- Shows: the file's column headings on one side, HOAhx's fields on the other, the suggested match for each and how sure it is; required fields with no match called out.
- Can do: upload; accept or change each match; mark a column "do not bring in"; continue.
- Draw these states: Tidy file, every match right | Messy file, two wrong guesses and a required column missing | Second import, 180 of 200 homes already exist

### D2 · Check it before it goes in
- Where: Community onboarding > property and owner import
- Shows: count of rows ready, rows needing a decision, rows that cannot go in. Three problems that look different: a duplicate, a missing required detail, a value that looks wrong but might be right. Only a blocked row stops the import; a warning does not.
- Can do: fix a row in place; leave a row out; accept a warning; download the problem rows.
- Draw these states: 200 rows: 188 ready, 9 warnings, 3 blocked | Clean file | Wrong file uploaded, nearly everything blocked

### D3 · Opening balances: the treasurer signs off
- Where: Community onboarding > property and owner import
- Shows: total of all opening balances; how many homes owe, how many in credit; the largest few; a box for the figure the treasurer expected.
- Can do: the treasurer (maybe a different person, a different day) compares and approves, or sends it back with a note.
- Draw these states: Totals agree | Differ by $450, showing where to look | Waiting for the treasurer (administrator's view) | Approved, import complete

### D4 · What past imports did, and fixing one
- Where: Community onboarding > property and owner import
- Shows: each import: date, who ran it, the file, how many homes, people and balances it added or changed.
- Can do: open one to see exactly what it changed; correct a mistake, with the correction on record.
- Draw these states: Three past imports | One opened, showing its changes | A wrong opening balance being corrected, and how it then shows in the ledger

### D5 · Who has joined
- Where: Community onboarding > invitation review
- Shows: every home and person against the four steps, totals at the top (200 invited, 141 joined, 120 verified, 112 active); whose invitation has lapsed.
- Can do: send again to one person or to everyone not joined, with a confirmation naming how many; see when each invitation was sent and when it lapses.
- Draw these states: Week one, most still invited | Week three, a stubborn thirty | A home with no email address

### D6 · Someone joined without an invitation
- Where: Community onboarding > invitation review
- Shows: to the board: who they say they are, the home they claim, their proof, whether that home already has an owner. To the person: a plain "we are checking" screen with what happens next and how long it usually takes.
- Can do: approve and link to the home; ask for more proof; decline with a reason.
- Draw these states: Easy match | Claim on a home with a different owner | The person's waiting screen | Last screen of joining: offer of automatic payments
