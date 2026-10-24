# Staff onboarding

Status: **ready, not run.** Pending owner: staff names and emails, store assignments with their ticks,
and running the 15-minute walkthrough with each store before the 14-day acceptance run (plan Step 8,
AC 6). No names appear in this file; use the tables below as a checklist outside the repo.

## 1. Accounts (admin)

There is no public sign-up and no SSO in phase 1 (spec §4). An admin creates each account, in either way:

- **`/admin/users`** ("Người dùng"): name, email, role `member` (staff) or `admin`, and a temporary
  password ("Mật khẩu tạm"); "Tạo người dùng".
- **CLI**, on the host that runs Ideas Hub, from the checkout:
  `IDEAS_HUB_NEW_PASSWORD='<temporary password>' pnpm --filter @ideas-hub/web auth:create-user --email <email> --name '<name>' --role member`.
  The password comes from the environment so it stays out of the shell history; set it with a leading
  space or `read -s` so it is not saved either.

Hand each person their password privately (not in the shared Lark group) and ask them to change it on
first sign-in: "Tài khoản" next to "Đăng xuất" opens `/account` (since #69; it signs out their other
sessions). A lost password still means the admin creates a new account or resets it in the database. A leaver is disabled with "Khóa" on `/admin/users`
(users are never deleted: their saved ideas keep `created_by`).

Use each person's work email: it is the cross-app key with POD Studio and the ERP's Keycloak in phase 2
(`docs/contracts/ideas-hub-v1.md`).

## 2. Stores and ticks (admin)

1. `/admin/stores` ("Store"): create each store ("Tạo store"). Optional now, needed later:
   "Mã store ERP" (`erp_store_code`), "ID store POD Studio" (`pod_studio_store_id`), "Lark chat ID" (the
   store's own chat, which gets its keyword reports).
2. Open the store, "Thêm thành viên", pick the user and tick:

| Tick | Gives | Typical staff |
|---|---|---|
| `view` | See the store's ideas and tracked keywords, and the AI sections of reports for the keywords it tracks | Everyone in the store |
| `save` | Create and edit ideas, change their status (implies `view`) | Everyone who picks ideas: **needed for AC 6** |
| `keywords` | Manage the store's tracked keywords and use "Run now" on them (implies `view`) | The store lead |

A person can be in several stores; with `save` on 2 or more, "Lưu" opens a store picker (2 actions instead
of 1). Admins see every store without ticks; admin saves do not count for AC 6 (only non-admin members),
so staff must not be admins.

Store-tracked keywords: anyone with the `keywords` tick (and admins) adds or stops them on "Keyword của
store" (`/store-keywords`, since #70), for the store picked in the switcher. Seed keywords stay on
`/admin/keywords`. New store keywords count toward the 80-keyword cap.

Checklist per store (fill outside the repo; pending owner):

| Store | `erp_store_code` | Lark chat | Member | `view` | `save` | `keywords` | Walkthrough done |
|---|---|---|---|---|---|---|---|
| `<store>` | `<code>` | `<chat>` | `<person>` | ✓ | ✓ | | `<date>` |

## 3. The morning flow (what staff do every day)

1. ~07:00 the Lark bot posts the summary (3 key points, top 5) to the shared group; the store's chat gets
   its keywords. Tap the link: it opens `/briefing` directly (0 actions with a valid session; the session
   lasts 7 days and renews on use).
2. Read the briefing: KPI row (ads running, change vs 7 days ago, crawl success, days to the next US
   holiday), then AI suggestions, trending ads, rising ads, hot keywords, rising shops, news and holidays.
3. Open an ad row (1 click) for its detail pane: thumbnail, caption, days active, countries, shop, link to
   the Ad Library; follow the shop or keyword for more (`/ads`, `/shops`, `/keywords`).
4. Save: "Lưu" on the row, the pane or a suggestion (1 action with one store; with several, pick and
   Enter). The toast "Đã lưu vào {store}" offers "Hoàn tác" for 10 s. Saves from the briefing count as
   `via = briefing`, which is what AC 6 counts.
5. Later in the day: `/ideas` (table or Kanban) to add notes and tags, set an assignee and move ideas
   New → Picked → Done or Dropped; "Xuất CSV" exports the list.

## 4. The 15-minute walkthrough

For each store, on the staff member's own PC at 1440 px or wider (and once on a phone), signed in with
their own account, during a morning after the briefing is ready. The facilitator reads the Vietnamese
lines; the English in brackets is the facilitator's cue and is not read out.

| Min | Facilitator does | Says to staff (Vietnamese) |
|---|---|---|
| 0–2 | Opens the Lark group, taps today's briefing link | "Mỗi sáng khoảng 7 giờ, bot Lark gửi tóm tắt vào nhóm. Bạn chỉ cần bấm link này là vào thẳng Briefing, không phải đăng nhập lại." |
| 2–4 | Points at the KPI row and the source-run label | "Hàng trên cùng là số ads đang chạy, thay đổi so với 7 ngày trước, tỉ lệ crawl thành công và số ngày tới ngày lễ Mỹ gần nhất. Dòng 'Từ run…' cho biết dữ liệu lấy từ lần chạy nào." |
| 4–7 | Walks the sections: trending ads, rising ads, hot keywords, rising shops | "Ads trend nhất là ads chạy lâu và thấy nhiều. Ads mới đang lên là ads mới xuất hiện nhưng tăng nhanh. Keyword và shop đang lên giúp bạn biết thị trường đang nóng ở đâu." |
| 7–9 | Opens one ad row, shows the pane, the Ad Library link, the shop | "Bấm vào một dòng để xem chi tiết: ảnh, caption, số ngày chạy, quốc gia, shop. Từ đây bạn mở được trang shop hoặc trang Ad Library gốc." |
| 9–11 | Has the staff member save one ad and one AI suggestion; shows the toast and "Hoàn tác" | "Thấy ý tưởng hay thì bấm 'Lưu'. Ý tưởng vào ngay danh sách của store. Lỡ bấm nhầm thì bấm 'Hoàn tác' trong 10 giây. Gợi ý AI cũng lưu được giống như vậy." |
| 11–13 | Opens `/ideas`, switches to Kanban, moves the saved idea to Picked, adds a note | "Đây là danh sách ý tưởng của store. Bạn ghi chú, gắn tag, giao người phụ trách, rồi chuyển trạng thái New, Picked, Done hoặc Dropped. Không cần kéo thả, dùng menu trạng thái cũng được." |
| 13–14 | Shows "Ý tưởng mới" (link and/or image) and Ctrl+K search | "Ý tưởng tự tìm được ở ngoài thì bấm 'Ý tưởng mới', dán link hoặc tải ảnh. Nhấn Ctrl+K để tìm nhanh ads, shop, keyword và ý tưởng đã lưu." |
| 14–15 | States the goal and where to ask | "Mục tiêu trong 14 ngày tới: mỗi sáng xem Briefing và lưu những ý tưởng đáng làm từ Briefing. Có lỗi hoặc thắc mắc thì nhắn admin." |

After the walkthrough, tick "Walkthrough done" in the checklist and confirm in `/ideas` that the
staff member's two practice saves are there. The 14-day run started on 2026-10-23, so a practice save
from the briefing now counts toward AC 6: either save an idea that is really worth doing, or remove a
practice save with "Hoàn tác" within its 10 seconds.

## Pending owner

- Staff names, emails and roles; the store list with `erp_store_code` and Lark chat ids.
- Store assignments and ticks (at least 2 stores with active savers: AC 6 needs ≥ 10 briefing saves in
  each of ≥ 2 stores).
- Running the walkthrough with every store, after the Linux switch and before the 14-day run starts.
- Store-tracked keywords for each store, on `/store-keywords` (production had none on 2026-10-24).
