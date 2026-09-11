# HOAhx Design Brief

For Tenyson Patridge, for Figma and for any design or code-generation tool you use. Prepared by Jacob West on September 11, 2026 from the `dev` branch at commit 5e44adb. This document supersedes the four design-system documents in `docs/` dated July 7 (`DESIGN_SYSTEM.md`, `HOA_HX_DESIGN_SYSTEM.md`, `DESIGN_SYSTEM_QUICK_REFERENCE.md`, `DESIGN_SYSTEM_REFERENCE.md`, `DESIGN_SYSTEM_IMPLEMENTATION.md`), which disagree with each other and with the code. Where this document and the code disagree, the code wins and this document gets fixed.

Companion files in this folder:

- `tokens.json` — every color, size, radius, type, and shadow token, resolved to exact values, in the W3C design-tokens format. Import into Figma with Tokens Studio (three sets: `global`, `light`, `dark`) or map to Variables.
- `prompt-preamble.md` — a one-page version of the constraints to paste at the top of any prompt.

---

## 1. How to use this

1. Read section 2 first. Those are the rules that do not move without a conversation.
2. Import `tokens.json` into Figma before drawing anything. Build styles and variables from it, not from screenshots.
3. Name Figma components and variant properties exactly as the code names them (section 5). The developer maps your file to `src/components/ui` by name.
4. Design every screen in light and dark, at 390×844 for phones and 1440×900 for desktop. Those are the sizes the automated tests use.
5. If you use a design or code-generation tool for any step, paste `prompt-preamble.md` at the top of the prompt and attach `tokens.json`. Ask it to output Tailwind 3.4 classes and existing `@/components/ui` imports, never raw hex or new packages.
6. Deliver in the order and by the dates in section 7. A design that arrives after its build week becomes rework, and rework is what moves the launch date.

---

## 2. Hard constraints

### 2.1 The stack is fixed for the launch

| Layer | What it is | What that means for design |
|---|---|---|
| Framework | React 18 with Vite, TypeScript (476 `.tsx` files, no `.jsx`) | Components are TypeScript; specs can be expressed as Tailwind classes. |
| Styling | Tailwind CSS **3.4.17** with `tailwindcss-animate`, class-based dark mode | Not Tailwind 4. No `@theme`, no OKLCH, no CSS-first config. Any tool output in Tailwind 4 syntax has to be translated. |
| Components | shadcn/ui, **new-york** style, base color neutral, CSS variables on, on Radix primitives with class-variance-authority | Use the shadcn Figma kit set to new-york. The default style's larger sizes and shadows do not match. |
| Icons | lucide-react 0.475 | Only lucide. 16px in buttons and sidebar, 20px in bottom tabs, 24px in empty-state tiles. |
| Type | Inter (Google Fonts, variable 300–800, optical sizing on) | One family. No display face. |
| Tokens | CSS variables holding HSL triplets in `src/index.css`, exposed as Tailwind colors in `tailwind.config.js` | Every color in a design must map to a token name (section 4.1) or a status tint family (section 4.2). |
| Motion | framer-motion 11 for sheets and page transitions; Tailwind transitions elsewhere | Springs and 120–200ms transitions. Nothing decorative. |
| Charts | recharts 2.15 through `ui/chart` | Chart colors are `chart-1` to `chart-5`. |
| Forms | react-hook-form + zod through `ui/form`; `input-otp` for code entry | Field, label, description, and error message are the shadcn form anatomy. |
| Toasts | Sonner (bottom-right on desktop, default Sonner placement) | One toast system. The two others in the code are being removed. |

### 2.2 Out of scope for the launch (do not design for these)

- Migrating to Tailwind 4 or to the current shadcn defaults.
- Any new UI library, icon set, or typeface.
- Redesigning the internals of the payment fields (they are NMI's embedded component; see 7.3).
- Passkeys as a sign-in method (planned after launch).
- Management-company and platform-staff screens for phones. They stay desktop.
- A Storybook or component catalog site.

### 2.3 Words that must stay stable

The automated test suite (1,230 browser tests) finds elements by **role and visible text**, not by hidden ids. Colors, spacing, radius, icons, and layout can change freely. Renaming a button, heading, tab, navigation item, or changing what kind of control something is (a link that becomes a button) breaks tests until they are updated.

- Navigation labels and sections come from the route registry (Appendix A). Reuse them.
- Page titles in the homeowner mobile header: My Requests, Messages, Parking, My Account, Payments, My Ledger, Violations, Amenities, Documents, Announcements.
- Primary actions keep their verbs: Pay Now, Submit Request, Save, Cancel, Confirm, Delete, Approve, Deny, Invite.
- If you propose a rename, deliver a list of old → new with the screen it appears on. It will be applied together with the test change, not silently.

### 2.4 Things the product already decided

- **Both themes.** Light and dark are both live. The theme toggle (Light / Dark / System) is in the app header, the platform header, and My Account. The default theme is being settled by the owners (the code currently disagrees with itself); design both and do not assume one.
- **Phones are a shell around the web app.** The iOS and Android apps are the same React app inside a native shell. Your phone designs are the app designs. Safe areas, 44px targets, bottom navigation, bottom sheets, and no hover-dependence are requirements, not polish.
- **Who gets phone designs.** Homeowners (and tenants) and board members. Management companies and HOAhx staff use desktop.
- **Homeowners never pay HOAhx.** They pay their community. The community pays its HOAhx subscription on the web, and that purchase is hidden inside the native apps.
- **Brand name spelling is pending.** The code says "HOA HX" in the browser title and the logo, the owners' documents say "HOAhx". Use "HOAhx" in designs until the owners confirm; do not draw a new logo until they do.

---

## 3. Product context

**What it is.** A trust layer for community living: homeowners pay dues, submit requests, read documents, reserve amenities, vote, and stay informed; boards and property managers run the community; HOAhx staff run the platform. The guiding question for every screen: *does this make the resident experience clearer, simpler, and more trustworthy?*

**Roles.** Platform: owner, support, viewer. Management: company admin, property manager. Board: president, secretary, treasurer, board member. Resident: homeowner, tenant. Scoped: vendor, auditor, attorney. One person can hold several of these across several communities and properties. The header carries a context switcher; switching never requires signing out. A first sign-in with more than one context shows an **account selector** screen.

**Modules that can be off.** Each community switches these on or off: parking, clubhouse and amenities, dog park, voting and meetings, surveys, document signatures, architectural review, visitor access, community feed, mass communications, analytics. When a module is off its navigation item disappears and its route shows a "module not enabled" page. Every module screen you design needs the off state considered (usually: it is simply absent).

**System banners.** These stack above the header when active and push content down: email verification (needs action), demo community (violet), support impersonation (orange, with the acting staff member named), and, from October, a community past-due banner for administrators (section 7.5).

**Data states.** Every list and dashboard tile has: loading (skeleton bars or skeleton cards), empty (icon tile, one-line title, one-line description, optional action), error (a "data unavailable" panel with retry), and populated. Design the empty and loading states, not only the populated one.

**Vocabulary the app already uses.** Requests (not tickets) for maintenance; Violations; Payments and Payment History (residents) versus Financials and Ledger (board); Assessments; Dues Schedule; Announcements; HOA Directory (community contacts) versus Neighbors (resident directory); Amenities (clubhouse reservations); My Household (people, pets, vehicles, gate codes); Member Management (admin roster). "HOA" and "community" are both used today; prefer "community" in new copy.

---

## 4. Foundations

### 4.1 Color tokens

Values are the exact hex the HSL triplets resolve to. Use the token name in specs; the hex is for Figma.

| Token | Light | Dark | Used for |
|---|---|---|---|
| background | #F8FAFC | #121417 | page ground |
| foreground | #0F1729 | #FFFFFF | body text |
| card / popover | #FFFFFF | #181A21 | surfaces, menus |
| card-foreground | #0F1729 | #FFFFFF | text on surfaces |
| primary | **#0074AD** | **#0074AD** | buttons, links, active states, focus ring |
| primary-foreground | #FFFFFF | #FFFFFF | text on primary |
| secondary | #EDF0F3 | #21252B | secondary buttons, quiet fills |
| secondary-foreground | #31425E | #9CA3B0 | text on secondary |
| muted | #EDF0F3 | #1D2025 | tab list track, skeletons, table header fill |
| muted-foreground | #65758B | #646A78 | captions, placeholders, inactive icons |
| accent | #3C83F6 | #3C83F6 | hover fills, secondary emphasis |
| destructive | #ED2C2C | #EF4343 | danger buttons (as 10% tint with border), errors |
| border / input | #DAE0E7 | #282C34 | rules, field borders |
| ring | #0074AD | #0074AD | focus ring |
| success | #29A847 | #29A847 | positive semantic |
| warning | #F59F0A | #F59F0A | caution semantic |
| danger | #ED2C2C | #ED2C2C | negative semantic |
| info | #3C83F6 | #3C83F6 | informational semantic |
| demo | #9932CD | #9932CD | demo-community banner |
| impersonation | #F97415 | #F97415 | support-impersonation banner |
| chart-1..5 | #3C83F6 · #29A847 · #F59F0A · #9932CD · #ED2C2C | same | recharts series |
| sidebar-background | #FFFFFF | #101114 | desktop sidebar |
| sidebar-foreground | #344365 | #9CA3B0 | sidebar text |
| sidebar-primary | #2474F5 | #3C83F6 | active sidebar icon, avatar tint |
| sidebar-accent | #EDF0F3 | #1D2025 | active sidebar item fill |
| sidebar-border | #DAE0E7 | #1B1D23 | sidebar rule |

Two facts to know about primary:

- **The brand has two teals today.** The primary token resolves to #0074AD. The favicon, code comments, and old docs say #0891B2. The owners are choosing one; until they do, use #0074AD (it is what every button ships with) and flag any place you need the brand mark.
- Primary is the same value in dark mode, which is on the low side for contrast against #121417 in small text. Buttons are fine (white on #0074AD). Avoid primary for small dark-mode text; use `accent` or `foreground`.

### 4.2 Status tints

Status badges, alert banners, and chips use Tailwind palette families rather than the semantic tokens. Keep the recipe: light = family-50 background, family-800 text, family-200 border; dark = family-500 at 15% background, family-300 text, family-500 at 25% border.

| Meaning | Family | Light bg / text / border | Dark text | Statuses that use it |
|---|---|---|---|---|
| Positive | emerald | #ECFDF5 / #065F46 / #A7F3D0 | #6EE7B7 | active, enabled, paid, approved, resolved, success |
| Caution | amber | #FFFBEB / #92400E / #FDE68A | #FCD34D | pending, in progress, medium |
| Negative | red | #FEF2F2 / #991B1B / #FECACA | #FCA5A5 | overdue, failed, denied, rejected, suspended, urgent, high |
| Informational | blue | #EFF6FF / #1E40AF / #BFDBFE | #93C5FD | open, completed, informational |
| Neutral | slate | #F1F5F9 / #475569 / #E2E8F0 | #94A3B8 | inactive, disabled, archived, closed, cancelled, refunded, low |
| On hold | orange | #FFF7ED / #9A3412 / #FED7AA | #FDBA74 | on_hold |
| System | violet | #F5F3FF / #5B21B6 / #DDD6FE | #C4B5FD | admin, super admin, premium, under review, demo |

Role badges use one family per role: platform owner violet, platform support indigo, platform viewer slate, management company admin fuchsia, property manager amber, president and secretary blue, treasurer emerald, board member cyan, resident green, tenant lime, vendor orange, auditor yellow, attorney rose.

Status dots (6px circles) exist in green, amber, red, and grey for inline list rows.

### 4.3 Type scale

Inter throughout. `font-feature-settings: cv02, cv03, cv04, cv11` (single-storey a, open digits).

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| h1 page title | 28px / tight | 600 | letter-spacing tight |
| h2 | 20px / snug | 600 | |
| h3 | 17px / snug | 600 | |
| h4 | 14px | 600 | |
| Dialog / sheet title | 18px | 600 | |
| Card title | 15px | 600 | |
| Body, buttons, inputs | 14px / 22px | 400 (500–600 for buttons) | the default |
| Card description, mobile empty-state body | 13px / relaxed | 400 | muted-foreground |
| Sidebar item | 13px | 500 | |
| Table header | 12px / uppercase, wide tracking | 600 | muted-foreground on muted/30 fill |
| Caption, helper | 12px / 18px | 400 | |
| Badge, pill | 11px | 600 | wide tracking |
| Bottom-tab label, sidebar section label | 10px | 600 | section labels uppercase, 8% tracking, 35% opacity |
| Editable fields on touch | 16px | 400 | prevents iOS zoom; enforced by CSS below 1024px |

### 4.4 Spacing, radius, elevation

- **Spacing** is Tailwind's 4px scale. Common rhythm: 8 / 12 / 16 / 20 / 24 / 32. Card padding 20px. Page frame padding 16px (phone), 24px (tablet), 32px (desktop).
- **Radius:** `--radius` 10px. Buttons, inputs, tab lists: 10px (small button and tab triggers 8px). Cards and alert banners: 14px (`rounded-xl`). Header menus, skeleton cards, large logo tile: 18px. Empty-state icon tile: 22px. Badges, switches, avatars, progress: full pill.
- **Elevation:** two soft shadows, `card-shadow` (1px 3px + 2px 6px, 5–7% black) and `card-shadow-lg`; dropdown shadow is deeper and dark-tuned. Cards additionally have a 1px border at 50% (`border-border/50`). Dark mode shadows are stronger (25–35% black). No colored shadows, no gradients.
- **Focus:** buttons and tabs show a 2px `ring` with 1px offset. Inputs show a 3px halo of primary at 20% and a primary border at 60%. Always visible on keyboard focus.
- **Press feedback:** buttons scale to 0.97 on press. Tappable rows and cards use the same scale plus 88% opacity for 120ms.
- **Disabled:** buttons at 35% opacity, inputs at 40%, other controls 50%.

### 4.5 Motion

- Buttons: 150ms color transitions. Accordion and fade-in: 200ms ease-out.
- MobileSheet: spring (damping 32, stiffness 380, mass 0.8) from the bottom, drag handle to dismiss, backdrop blur.
- Page transitions exist (framer-motion) and are subtle. Respect `prefers-reduced-motion`.
- Skeletons pulse; a shimmer utility exists for long loads.

### 4.6 Iconography

lucide-react only, stroke icons, 16px default. Bottom tabs 20px. Empty-state and quick-action tiles hold a 24–28px icon inside a 40–56px rounded tile with a 10–15% tinted fill. The brand mark is a rounded tile with "HX" in black weight; it is due for a decision (2.4), so do not multiply variants of it.

---

## 5. Component inventory

Everything below exists in `src/components/ui`. Figma component names and variant properties should match the **Code name** and **Variants** columns exactly.

### 5.1 shadcn primitives (49)

| Code name | Variants / sizes as shipped | Key measurements | Notes |
|---|---|---|---|
| Button | variant: default, destructive, outline, secondary, ghost, link · size: default, sm, lg, icon | default 36px high, 16px side padding, 14px text; sm 28px, 12px text, radius 8; lg 40px, 20px padding, 15px text; icon 36×36; radius 10px | default is solid primary with white text; destructive is a 10% destructive tint with 20% border and destructive text (not solid red); outline sits on secondary fill; 44px minimum hit area below 1024px |
| Badge | variant: default, secondary, destructive, success, warning, outline | 11px / 600, 10px side padding, pill | default is primary at 10% with primary text |
| Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter | — | radius 14px, 1px border at 50%, card-shadow; header and content padding 20px; title 15px / 600; description 13px muted | |
| Input | — | 36px high, radius 10px, 12px side padding, 14px text (16px on touch) | placeholder at 60% muted; focus ring 2px primary/40 |
| Textarea | — | min 60px, radius 8px | |
| Select, SelectTrigger, SelectContent, SelectItem | — | trigger matches Input; items 14px with 8px/6px padding | |
| Checkbox | — | 16px, radius 6px (`rounded-sm` in this config), primary border and fill | |
| RadioGroup, RadioGroupItem | — | 16px circle, primary border | |
| Switch | — | 36×20 track, 16px thumb, pill | checked = primary |
| Slider | — | Radix default | |
| Label | — | 14px / 500 | |
| Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage | — | description 13px muted, message 13px destructive | the anatomy every form uses |
| Tabs, TabsList, TabsTrigger, TabsContent | — | list 36px high, muted track, radius 10px, 4px inner padding; active trigger has card fill and shadow | 44px hit area below 1024px |
| Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter | — | title 18px / 600; footer buttons right-aligned on desktop, stacked reverse on phone; ConfirmModal uses max-width 384px | on phones the content is inset by 16px gutters and respects safe areas |
| AlertDialog | — | as Dialog | for destructive confirmations |
| Sheet, SheetContent (side: top, right, bottom, left) | — | full-width and full-height on phones with 24px safe-area padding | |
| Drawer | — | vaul bottom drawer | |
| Popover, HoverCard, Tooltip | — | Radix defaults, card surface, 1px border | |
| DropdownMenu, ContextMenu, Menubar, NavigationMenu | — | menus are card surface, radius 18px on the header account menu, 6px item padding | |
| Command | — | cmdk palette | |
| Calendar | — | react-day-picker 8 | |
| InputOTP | — | 6-cell code entry | use for two-factor codes, autofill-friendly |
| Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption | — | header cells 48px high, 12px uppercase muted on muted/30 fill, 20px side padding; body cells 16px vertical, 20px side; rows 1px border at 40%, hover muted/40, selected primary/5 | |
| Accordion, Collapsible | — | 200ms open/close | |
| Avatar, AvatarImage, AvatarFallback | — | 40px circle | header avatar is 28px with primary/15 fill and initials |
| Progress | — | 8px track, primary/20 with primary fill, pill | |
| Skeleton | — | pulse, radius 6px, primary/10 | LoadingSkeleton family below is more used |
| Separator | — | 1px border | |
| ScrollArea, AspectRatio, Resizable, Carousel, Pagination, Breadcrumb, Toggle, ToggleGroup | — | shadcn defaults | |
| Chart | — | recharts wrapper using chart-1..5 | |
| Sonner (Toaster) | — | background surface, border, shadow-lg; action button primary | the one toast system |
| Toast, Toaster, use-toast | — | legacy shadcn toast | being removed; do not design for it |

### 5.2 In-house components (10)

| Code name | Props / variants | Anatomy | Use |
|---|---|---|---|
| StatusBadge | status preset (active, inactive, suspended, enabled, disabled, archived, open, in_progress, on_hold, resolved, closed, paid, pending, overdue, failed, refunded, approved, denied, rejected, and more) | pill, 11px / 600, tint per 4.2 | any lifecycle or payment state |
| RoleBadge | role | pill, 11px / 600, one family per role | wherever a person's role is shown |
| EmptyState | icon, title, description, action | 56px tile (radius 22, muted fill, 24px icon at 50%), 14px / 600 title, 14px muted description max 320px, action 20px below; 64px vertical padding | desktop lists and tables |
| MobileEmptyState | icon, title, description, action {label, onClick} | 56px tile (radius 18, muted/60), 15px / 600 title, 13px description max 260px | homeowner phone screens |
| AlertBanner | variant: info, success, warning, error · title, message, onDismiss | radius 14px, 14px padding, 16px icon, 14px / 600 title, 14px message at 80% | inline contextual alerts inside a page |
| ConfirmModal | title, description, confirmLabel, cancelLabel, variant: destructive or default, loading | Dialog at 384px, icon tile (destructive/10 or primary/10), two buttons | confirmations |
| LoadingSkeleton: SkeletonBar, SkeletonTableRows, SkeletonCards, PageLoader | rows, cols, count, label | bars radius 8px; skeleton cards radius 18px with card-shadow; PageLoader is a 40px tile with a spinner and a 14px label | loading states |
| MobileSkeleton | — | phone-tuned skeleton set | |
| MobileSheet | open, onClose, title, subtitle, maxHeight (92vh) | bottom sheet with handle, spring, backdrop blur, keyboard-aware, safe-area bottom padding | forms, details, pickers on phones instead of Dialog |
| ErrorBoundary | — | render-error fallback | |

Also in `src/components/common`: DataUnavailable (error state with retry). In `src/components/theme`: ThemeToggle (Light / Dark / System segmented control).

### 5.3 Do not build on these

`src/components/design-system/` (Button, Badge, Card, DataTable, EmptyState, FormElements, KpiSection, ListEmptyState, LoadingState, PageLayout) is a July experiment used by three files, and the `.btn-*` / `.badge-*` CSS utility classes are its siblings. They are being retired in favor of `ui/`. If you need a KPI tile or a data table pattern, compose it from Card and Table and name it as a new pattern.

---

## 6. Layout system

### 6.1 Frame sizes

- **Phone:** 390×844 (the test viewport; iPhone 14/15/16 class). Also check 360 wide for Android.
- **Desktop:** 1440×900 (the test viewport). The sidebar appears at **1024px**; below that the phone layout applies, including on tablets.

### 6.2 The application shell (everyone except platform staff)

Desktop, 1024px and up: a grid of a **240px sidebar** (60px when collapsed, toggle at the sidebar's top right), a **56px header**, and a scrolling content area.

- **Sidebar:** sidebar-background, 1px sidebar-border on the right. Community name row with a dot indicator. Sections labeled in 10px uppercase at 35% opacity. Items 36px min height, 13px / 500, 16px icon at 40% opacity, radius 10px; active item has sidebar-accent fill, sidebar-accent-foreground text, sidebar-primary icon. Bottom: the person's role label and an account row with a 32px initials avatar.
- **Header:** card at 95% with blur, 1px border, 20px side padding. Left: page breadcrumb or context indicator with a primary dot and the community name. Right: context switcher, theme toggle, notifications, and a 28px initials avatar that opens a 224px account menu (radius 18px).
- **Content:** a **page frame** with 16 / 24 / 32px padding by breakpoint and a max width from the route registry: narrow 672px, standard 960px, wide 1200px, full. Sections stack with 16px gaps.

Phone, below 1024px: no sidebar. Header hidden in favor of page-level headers. **Bottom tab bar** 64px minimum plus safe-area inset, card at 98% with blur and a top border: up to **four tabs** chosen by the registry's phone priority (for a resident: Dashboard, My Requests, Messages, My Account) plus a **More** button that opens a drawer listing everything else grouped by section, with a sign-out row. Tabs: 20px icon, 10px / 600 label, 56px minimum width, active shown in primary with a 2px × 24px bar at the top.

### 6.3 The homeowner mobile family

A dedicated phone layout in `src/components/layout/homeowner/` (root file `HomeonerMobileLayout.tsx`, spelled that way in the code), used today by one page and being rolled across every homeowner screen on September 14–15. Design homeowner phone screens to this family:

- **Header:** fixed, 56px plus safe-area top. On the dashboard: community name and "Homeowner Portal" label. On sub-pages: page title, a Back button on detail pages, a notification bell, and a profile avatar linking to My Account.
- **Bottom nav:** fixed, 60px plus safe-area. Five primary tabs: Home, Requests, Messages, Parking (hidden when the module is off), Account, plus **More**. The More drawer has a 3×3 **Quick Actions** grid (Submit Request, Message HOA, My Violations, Guest Pass, Reserve Space), an **All Services** list (HOA Directory, Neighbors, Amenities, Dog Park, Payments, Violations, Payment History, Documents, Community Events, Voting & Meetings, My Profile, Notifications), and a user card with Sign Out.
- **Page container:** 16px side padding (12px compact), top padding 56px plus safe area, bottom padding 80px plus safe area (24px when the nav is hidden), content max width 672px centered, momentum scroll, pull-to-refresh, per-tab scroll position memory.
- **Content pieces:** MobileContentSection (title, subtitle, optional card styling, right-side action), MobileListItem (icon, label, subtitle, chevron, active and disabled states, press feedback), MobileActionCard (40px tinted icon tile, centered label).

### 6.4 The platform layout (HOAhx staff)

Separate sidebar and header family in `src/components/layout/superadmin/` with violet accents for platform-only signals and amber counters. Desktop only. Not in scope for redesign.

### 6.5 Authentication

`AuthLayout` and `AuthCard` in `src/components/auth`: a centered card, 40px inputs, inline destructive alert for errors (destructive/8 fill, 20% border, radius 14px), social sign-in buttons (Google, Apple), links in primary at 12px / 500. Pages: sign in, register, forgot and reset password, accept invitation, join community, tenant invitation, session expired. Two-factor setup and challenge screens are new (7.4).

---

## 7. Screens to design, in order

Dates are the build days from the launch plan. A design is useful when it arrives before its build day; after that it is a change to built work and has to be scheduled separately.

| Order | Screens | Build days | Layout family | Fixed constraints |
|---|---|---|---|---|
| 1 | Homeowner phone screens (7.1) | Mon–Tue Sep 14–15 | Homeowner mobile | Nav labels and tabs as in 6.3; module-off states |
| 2 | Payment flow on `/my-payments` (7.3) | Tue Sep 15 (owners see it the same day) | Homeowner mobile + desktop standard frame | NMI embedded fields; the current payment modal is being replaced, do not reference it |
| 3 | Board day-to-day screens on a phone (7.2) | Wed–Thu Sep 16–17 | Application shell, phone mode | Existing admin labels; tables become cards or stacked rows on phones |
| 4 | Two-factor setup and challenge, app lock (7.4) | Wed–Thu Sep 16–17; lock screen Sep 23 | Auth layout; native | Your September 8 requirements are the spec |
| 5 | App icon, splash, manifest icons (7.6) | Mon Sep 21 | — | Brand spelling and teal decided by then |
| 6 | Store screenshots and listing (7.6) | by Wed Sep 30 | — | Owners choose the theme shown |
| 7 | Community past-due banner and read-only states (7.5) | Oct 5–8 | Application shell | Your September 8 recommendation, adopted by the owners |

### 7.1 Homeowner phone screens

Routes, with the page file in `src/pages` and the frame width the registry assigns for desktop:

| Route | Title | Page | Width | What is on it |
|---|---|---|---|---|
| `/` | Home | ResidentDashboard.tsx | wide | today: My Requests, My Reservations, Upcoming Meetings, a "Your vote is needed" prompt; a balance and next-due tile is part of the payment work |
| `/my-payments` | Payments | MyPayments.tsx | standard | see 7.3 |
| `/my-ledger` | Payment History | ledger/ | standard | history rows with StatusBadge, receipts |
| `/my-assessments` | Assessments | MyAssessments.tsx | standard | dues schedule, special assessments, late fee and grace period |
| `/my-maintenance` | My Requests | maintenance/ | narrow | request list, submit sheet with category, photos (camera in the app), status timeline |
| `/my-violations` | Violations | violations/MyViolations.tsx | narrow | already on the mobile family; notices, evidence, appeal / respond |
| `/my-household` | My Household | MyHousehold.tsx | standard | people, dependents, pets, vehicles, tenants; **gate code and guest code** with a "code not working / change my code" request (new, September) |
| `/my-account`, `/my-profile`, `/privacy-security`, `/my-notification-settings` | My Account… | MyAccount.tsx, MyProfile.tsx, PrivacySecurity.tsx, NotificationSettings.tsx | narrow | profile, theme toggle, two-factor status (7.4), sessions, **account deletion request** (new), notification preferences |
| `/messages` | Messages | Messages.tsx | full | conversations with the community office |
| `/documents` | Documents | documents/ | standard | folders, files, "board only" items are simply absent for residents |
| `/my-communications` | HOA Directory | communications/ | full | community announcements with read states, and contacts (`/announcements` itself is the board's compose screen) |
| `/events` | Events | events/ | wide | calendar list, RSVP |
| `/my-parking`, `/my-clubhouse`, `/my-dog-park`, `/my-visitors`, `/my-architectural`, `/my-voting`, `/my-surveys`, `/my-signatures`, `/community-feed`, `/resident-directory` | module screens | parking/, clubhouse/, dogpark/, visitors/, architectural/, voting/, surveys/, feed/, directory/ | standard / wide | each disappears when its module is off |

Design rules for this family: one primary action per screen, visible without scrolling; lists as MobileListItem rows or cards, never tables; forms in MobileSheet; StatusBadge on every stateful row; MobileEmptyState on every list; money always with cents; dates absolute ("Oct 1, 2026"), relative only as a secondary line.

### 7.2 Board day-to-day screens on a phone

The board uses the application shell (6.2) in phone mode. Screens: `/announcements` (compose and send), `/maintenance` Requests (queue, assign, update status), `/violations` (issue, review, fees), `/payments` and `/ledger` Financials (who has paid, what is overdue), `/residents` Member Management (roster, invite). Desktop tables become stacked rows with the key figure first and a StatusBadge; filters move into a Sheet; primary actions sit in a sticky bottom bar above the tab bar. Refunds become a **two-person action** in the build week: an initiator requests, a second approver with a financial role approves, each after a fresh sign-in prompt, original payment method only.

### 7.3 The payment flow

The card, bank-account, Apple Pay, and Google Pay fields are **NMI's embedded Payment Component**, rendered inline on `/my-payments` (no redirect, no popup). It accepts a theme (Inter, primary #0074AD, radius 10px, light and dark palettes) and nothing else about its internals can change. HOAhx draws everything around it. Design these states:

1. **Balance and schedule:** amount due, due date, grace period and late fee from the published dues schedule, **Pay Now**. Community not yet set up for payments: *"Online payments are not yet available for this community. Contact your community administrator for payment instructions."*
2. **Amount:** full balance or another amount; summary line.
3. **Method:** saved methods (cards as brand and last four with expiry, banks as "Bank •••3815"), or new card / bank; Apple Pay and Google Pay buttons appear only where the device supports them.
4. **Fields:** the embedded component; HOAhx shows the Pay button, amount, and errors below it.
5. **Result:** *Payment received* with a confirmation number (the transaction id), balance updated, a history row; **or** a decline with a plain message and a retry path, balance unchanged; **or** for bank payments *Bank payment submitted*, pending until the bank settles, then Paid. Returned bank payments reverse with a notice and a return fee line.
6. **AutoPay:** save this method, AutoPay on or off, schedule (monthly on the community's due date, including special assessments and late fees), next charge date, pause and resume, a failed-charge alert, and a card-expiry notice three months ahead.
7. **Receipts and history:** each payment with status, method, and a receipt.

Light and dark, phone and desktop, all seven. The owners walk through this on September 15.

### 7.4 Sign-in security

Your September 8 requirements are the spec for the build on September 16–17:

- **Setup, one step at a time:** choose a method → verify it → save backup codes. Methods: authenticator app; text-message codes for residents who opt in. Roles that move money and HOAhx staff are required to enroll; residents are optional. (Whether required roles may also choose text codes is being discussed on September 14.)
- **Code entry:** InputOTP, accepts autofill and paste; *"Can't access your device?"* clearly visible on the challenge screen.
- **Recovery:** backup codes; a staff-assisted recovery process that verifies identity.
- **Changing methods:** requires verification; the new method is confirmed before the old one is removed.
- **Password:** 15-character minimum everywhere, no composition rules, spaces allowed; shown plainly on register, invite, and reset.
- **App lock (native, September 23):** after 15 minutes inactive or in the background the app locks and reopens with Face ID, fingerprint, or the device PIN. The biometric unlocks a session that was signed in with the code; it is not itself the second factor.
- **Account deletion:** a resident can request deletion of their account; the request and its outcome are shown plainly (new in the launch).

### 7.5 Community past-due banner (administrators only)

Your recommendation, adopted by the owners on September 8, builds October 5–8. States: active → past due in grace (days 1–15) → past due with fees (day 16) → read-only (day 30) → suspended (day 60) → referred to collections (day 90). Residents are never affected. Design:

- A persistent banner for the responsible administrators showing the **amount owed, the exact deadline, and what happens next**, with **Pay balance** and an update-payment-method option; advance notice before each access change.
- The **read-only** state explains that records remain available but changes are restricted; billing and support stay reachable during suspension.
- Notices are labeled as the community's HOAhx subscription, separate from homeowner dues.
- Access is restored automatically once payment is confirmed.
- Also: an "update payment information" alert and a card-expiry notice three months out.

### 7.6 Native app and store assets

Confirm sizes against the current Apple and Google guidelines when you export; these are the standard set:

| Asset | Size | For |
|---|---|---|
| Web manifest icons | 192×192 and 512×512 PNG, plus a maskable 512 | installable web app (this week; a placeholder ships if none arrives) |
| iOS app icon | 1024×1024 PNG, no transparency, square (the system rounds it) | App Store and device |
| Android adaptive icon | foreground 432×432 px on a 108dp canvas, safe zone 66dp; background layer | Play and device |
| Splash | 2732×2732 PNG, mark centered, solid background in both themes | Capacitor splash |
| App Store screenshots | 6.9" 1320×2868 and 6.5" 1284×2778 (or 1242×2688), portrait | store listing |
| Google Play screenshots | portrait PNG or JPEG, 320–3840px on each side; feature graphic 1024×500 | store listing |

The app name, privacy-policy page, and support email are the owners' to provide by September 18.

---

## 8. Copy rules

- Plain, resident-first, transparent. Say what happened and what happens next.
- Money with cents ($250.00). Dates absolute (Oct 1, 2026); relative time only as a secondary line.
- Status words match the StatusBadge presets (paid, pending, overdue, open, in progress, resolved…).
- Community subscription notices say "your community's HOAhx subscription"; homeowner dues never mention HOAhx as the payee.
- No exclamation marks, no "Oops", no jargon (tokenization, webhook, gateway). Errors say what to do.
- Do not describe the product as already running or as having customers; HOAhx has not launched.

---

## 9. Deliverables and hand-off

**Figma file structure**

1. **Foundations:** variables and styles from `tokens.json` (light and dark modes), type styles from 4.3, effect styles from 4.4.
2. **Components:** one component per code name in section 5, variants named as the code names them (`Button / variant=outline / size=sm`, `Badge / variant=warning`, `StatusBadge / status=overdue`). Both modes.
3. **Patterns:** page frame, sidebar, header, bottom tab bar, More drawer, homeowner header and nav, MobileSheet form, table on desktop and its phone row, empty / loading / error trio.
4. **Screens:** one page per group in section 7, phone at 390×844 and desktop at 1440×900 where the screen exists on desktop, light and dark.
5. **Assets:** icon, splash, manifest icons, screenshots.

**Per screen, annotate:** the route; the layout family; module flags that hide parts of it; every StatusBadge preset used; any label that differs from the registry (old → new); Tailwind classes where the intent is not obvious (spacing and color as token names, not hex).

**Hand-off cadence:** homeowner screens before September 14, payment flow before September 15, board screens before September 16, security screens before September 16, icon and splash before September 21, screenshots before September 30, banner before October 5. Anything after its date is scheduled as a change, not absorbed.

**Review:** you are welcome to review the built screens for security (September 16–17) and payments (September 15) before they merge, and to be on the September 25 test-build list.

---

## 10. If you commit code

- Node 22. `npm install`, then `npm run dev`. Real data needs the Firebase environment values from Jacob; the alternative is the emulator with a seeded demo community, which needs no credentials (ask for the start command).
- Branch from `dev`, pull request to `dev`. `main` requires a pull request and a green **Build & test** check. Every pull request runs the build, unit and rules tests, lint (an unused import is an error), a strict typecheck, and the 1,230 browser tests in five parallel shards. Expect about 40 minutes. Keep pull requests small: one screen or one primitive.
- Tokens change only in `src/index.css` and `tailwind.config.js`. Components change only in `src/components/ui`. Nothing hard-coded in pages.
- Do not run the shadcn CLI until Jacob has flipped `"tsx": false` to `true` in `components.json`; today the CLI would write JavaScript files into a TypeScript repo. When it is on, diff Button and Badge before accepting regenerated versions; both are customized (touch targets, radius, extra variants).
- Toasts: import from `sonner`. Do not import `react-hot-toast` or `@/components/ui/use-toast`.
- Before the first commit from a new GitHub account, tell Jacob: the hosting account adds a paid seat automatically for new committers and the owners decide that.
- No branch previews are published automatically. Ask for one when you need it.

---

## Appendix A. Route registry: navigation labels, sections, and page widths

Generated from `src/lib/appRouteRegistry.ts`. "Phone tab" is the priority the bottom tab bar uses (lowest four shown for the person's role). "Module" is the community feature flag that hides the route when off. Hidden routes are detail pages reached from a parent, not navigation items. Access is enforced in code and on the server; the "Who" column is the intended audience.

110 routes.

| Route | Label | Section | Who | Module | Width | Phone tab | In nav |
|---|---|---|---|---|---|---|---|
| `/` | Dashboard | Overview | Every role with a dashboard | — | wide | 1 | yes |
| `/select-context` | Select Context | Account | Everyone signed in | — | narrow | — | no |
| `/account-suspended` | Account Suspended | Account | Everyone signed in | — | narrow | — | no |
| `/session-expired` | Session Expired | Account | Everyone signed in | — | narrow | — | no |
| `/tenant-error` | Tenant Context Error | Account | Everyone signed in | — | narrow | — | no |
| `/platform/dashboard` | Dashboard | Platform | HOAhx staff | — | full | 1 | yes |
| `/platform/hoas` | HOA Clients | Platform | HOAhx staff | — | full | 2 | yes |
| `/platform/users` | Platform Users | Platform | HOAhx staff | — | full | — | yes |
| `/platform/analytics` | Analytics | Platform | HOAhx staff | — | full | 3 | yes |
| `/platform/activity-log` | Activity Log | Oversight | HOAhx staff | — | full | — | yes |
| `/platform/feedback` | Feedback | Oversight | HOAhx staff | — | full | — | yes |
| `/platform/impersonation-log` | Impersonation Log | Oversight | HOAhx staff | — | full | — | yes |
| `/platform/access-requests` | Access Requests | Access | HOAhx staff | — | full | — | yes |
| `/platform/manage-access` | Manage Access | Access | HOAhx staff | — | full | — | yes |
| `/platform/billing` | Billing | Business | HOAhx staff | — | full | — | yes |
| `/platform/notifications` | Notifications | Account | HOAhx staff | — | standard | — | no |
| `/platform/notification-settings` | Notification Settings | Account | HOAhx staff | — | narrow | — | no |
| `/platform/recovery` | Recovery | Access | HOAhx staff | — | narrow | — | no |
| `/demo` | Demo Communities | Platform | HOAhx staff | — | wide | — | no |
| `/my-household` | My Household | My Community | Residents | — | standard | — | yes |
| `/residents` | Member Management | Administration | Board / management | — | full | 2 | yes |
| `/properties` | Properties | Administration | Board / management | — | full | — | yes |
| `/maintenance` | Requests | Operations | Board / management | — | full | 3 | yes |
| `/my-maintenance` | My Requests | My Community | Residents | — | narrow | 2 | yes |
| `/assigned-work` | Assigned Maintenance | Assigned Work | Vendor / auditor / attorney | — | standard | 1 | yes |
| `/vendors` | Vendor Directory | Operations | Board / management | — | wide | — | yes |
| `/violations` | Violations | Operations | Board / management | — | full | — | yes |
| `/violations/issue` | Issue Violation | Operations | Board / management | — | full | — | no |
| `/violations/review` | Review Violation | Operations | Board / management | — | full | — | no |
| `/violations/fees` | Violation Fees | Operations | Board / management | — | full | — | no |
| `/violations/delinquency` | Delinquency | Operations | Board / management | — | full | — | no |
| `/violations/escalation` | Escalation Queue | Operations | Board / management | — | full | — | no |
| `/my-violations` | My Violations | My Community | Residents | — | narrow | — | yes |
| `/documents/admin` | Documents | Community | Board / management | — | full | — | yes |
| `/documents` | Documents | My Community | Everyone signed in | — | standard | — | yes |
| `/messages` | Messages | Community | Everyone signed in | — | full | 3 | yes |
| `/community-feed` | Community Feed | Community | Everyone in the community | community_feed | standard | — | yes |
| `/events` | Events | Community | Everyone in the community | — | wide | — | yes |
| `/community-calendar` | Legacy Calendar Redirect | Community | Everyone in the community | — | wide | — | no |
| `/voting` | Voting & Meetings | Governance | Vote managers | voting | standard | — | yes |
| `/my-voting` | My Voting | Governance | Residents | voting | standard | — | yes |
| `/governance` | Governance | Governance | Board and management | voting | wide | — | yes |
| `/surveys` | Surveys | Community | Board / management | surveys | standard | — | yes |
| `/my-surveys` | Surveys | My Community | Residents | surveys | standard | — | yes |
| `/my-signatures` | Signatures | My Community | Residents | signatures | narrow | — | yes |
| `/announcements` | Announcements | Communications | Board / management | — | full | — | yes |
| `/mass-communications` | Mass Communications | Communications | Board / management | mass_communications | wide | — | yes |
| `/my-communications` | HOA Directory | My Community | Residents | — | full | — | yes |
| `/ai-assistant` | AI Assistant | My Community | Residents | ai_assistant | standard | — | no |
| `/parking` | Parking | Property | Board / management | parking | full | — | yes |
| `/my-parking` | My Parking | Property | Residents | parking | standard | — | yes |
| `/clubhouse` | Clubhouse Reservations | Property | Everyone in the community | clubhouse | wide | — | yes |
| `/my-clubhouse` | My Amenities | Property | Residents | clubhouse | standard | — | yes |
| `/dog-park` | Dog Park | Property | Directory managers | dog_park | wide | — | yes |
| `/my-dog-park` | Dog Park | Property | Residents | dog_park | standard | — | yes |
| `/visitor-access` | Visitor Access | Property | Directory managers | visitor_access | standard | — | yes |
| `/my-visitors` | Visitor Access | Property | Residents | visitor_access | standard | — | yes |
| `/architectural-review` | Architectural Review | Property | Architectural reviewers | architectural_review | standard | — | yes |
| `/my-architectural` | Architectural Requests | Property | Residents | architectural_review | standard | — | yes |
| `/directory` | HOA Directory | Directory | Board and management | — | wide | — | yes |
| `/resident-directory` | Neighbors | Directory | Everyone signed in | — | wide | — | yes |
| `/directory/residents` | Neighbor Directory | Directory | Everyone signed in | — | wide | — | no |
| `/my-directory` | Resident Directory | Directory | Residents | — | wide | — | no |
| `/ledger` | Financials | Financial | Board / management | — | full | — | yes |
| `/financial-reports` | Financial Reports | Financial | Financial report readers | — | full | — | yes |
| `/budget-transparency` | Budget | Financial | Board / management | — | full | — | yes |
| `/my-payments` | Payments | Financial | Residents | — | standard | — | yes |
| `/my-ledger` | Payment History | Financial | Residents | — | standard | — | yes |
| `/my-assessments` | Assessments | Financial | Residents | — | standard | — | yes |
| `/hoa-subscription` | HOA Subscription | Financial | Board / management | — | standard | — | no |
| `/dues-schedule` | Dues Schedule | Financial | Board / management | — | standard | — | yes |
| `/payments/manual` | Record Manual Payment | Financial | Board / management | — | standard | — | no |
| `/payments/reconciliation` | Payment Reconciliation | Financial | Board / management | — | full | — | no |
| `/financial-reports/audit` | Audit Reports | Financial | Vendor / auditor / attorney | — | full | — | yes |
| `/payments` | Payments | Financial | Community admins | — | full | — | no |
| `/subscriptions` | Subscriptions | Financial | Community admins | — | full | — | no |
| `/my-subscription` | My Subscription | Account | Residents | — | standard | — | no |
| `/analytics` | Analytics | Administration | Board / management | analytics | full | — | yes |
| `/hoa-settings` | HOA Settings | Administration | Settings viewers | — | standard | — | yes |
| `/re-engagement` | Resident Re-engagement | Administration | Board / management | — | standard | — | yes |
| `/hoa-settings/permissions` | Permissions | Administration | Board / management | — | wide | — | yes |
| `/activity-log` | Audit Log | Administration | Board / management | — | full | — | yes |
| `/ai-insights` | AI Insights | Administration | Community admins | analytics | full | — | no |
| `/notifications` | Notifications | Administration | Board / management | — | standard | — | no |
| `/notification-settings` | Notification Templates | Administration | Board / management | — | narrow | — | no |
| `/amenities` | Amenities | Administration | Community admins | clubhouse | full | — | no |
| `/communications` | Communications | Administration | Board / management | — | full | — | no |
| `/my-profile` | My Profile | Account | Residents | — | narrow | — | yes |
| `/my-notifications` | Notifications | Account | Residents | — | standard | — | yes |
| `/my-notification-settings` | Notification Settings | Account | Residents | — | narrow | — | yes |
| `/my-account` | My Account | Account | Residents | — | narrow | 4 | yes |
| `/privacy-security` | Privacy & Security | Account | Everyone signed in | — | narrow | — | no |
| `/platform/hoas/:id` | HOA Client | Platform | HOAhx staff | — | full | — | no |
| `/platform/hoas/onboard` | Create HOA | Platform | HOAhx staff | — | standard | — | no |
| `/platform/billing/accounts` | Billing Accounts | Business | HOAhx staff | — | full | — | no |
| `/platform/billing/profile/:id` | Billing Profile | Business | HOAhx staff | — | wide | — | no |
| `/platform/billing/renewals` | Renewals | Business | HOAhx staff | — | full | — | no |
| `/platform/billing/invoices` | Invoices | Business | HOAhx staff | — | full | — | no |
| `/platform/billing/audit` | Billing Audit | Business | HOAhx staff | — | full | — | no |
| `/platform/billing/plans` | Billing Plans | Business | HOAhx staff | — | wide | — | no |
| `/management/portfolio` | Portfolio | Management Company | Management company | — | full | — | yes |
| `/management/portfolio/financials` | Portfolio Financials | Management Company | Management company | — | full | — | no |
| `/management/portfolio/audit` | Portfolio Audit | Management Company | Management company | — | full | — | no |
| `/management/portfolio/:hoaId` | Portfolio HOA | Management Company | Management company | — | full | — | no |
| `/management/hoas/onboard` | Add Managed HOA | Management Company | Management company | — | standard | — | yes |
| `/onboarding/hoa` | HOA Setup | Onboarding | Onboarding | — | standard | — | no |
| `/onboarding/resident` | Resident Setup | Onboarding | Onboarding | — | standard | — | no |
| `/onboarding/re-engage` | Re-engagement | Onboarding | Onboarding | — | standard | — | no |
| `/parking/resident/:residentId` | Resident Parking | Property | Board / management | parking | wide | — | no |
| `/parking/analytics` | Parking Analytics | Property | Board / management | parking | full | — | no |

## Appendix B. Where things live

| What | Where |
|---|---|
| Tokens | `src/index.css` (`:root, .light` and `.dark` blocks), `tailwind.config.js` |
| shadcn config | `components.json` |
| Primitives and in-house components | `src/components/ui/` |
| Application shell | `src/components/layout/AppLayout.tsx`, `src/components/layout/app-shell/` |
| Homeowner mobile family | `src/components/layout/homeowner/`, guide in `docs/HOMEOWNER_MOBILE_LAYOUT_GUIDE.md` |
| Platform layout | `src/components/layout/superadmin/` |
| Auth layout | `src/components/auth/AuthLayout.tsx`, `AuthCard.tsx` |
| Page frame widths | `src/lib/responsive.ts` |
| Route registry (nav labels, sections, widths, flags) | `src/lib/appRouteRegistry.ts` |
| Module flags | `src/lib/hoaFeatures.ts` |
| Theme | `src/lib/ThemeContext.tsx`, `src/components/theme/ThemeToggle.tsx`, pre-paint script in `index.html` |
| Brand mark | `src/components/brand/RavionLogo.tsx` (the file name is historical) |
| Pages | `src/pages/` (109 files) |
| Browser tests that assert labels | `tests/ui/` (30 spec files, 14 role folders) |
