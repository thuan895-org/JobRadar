# JobRadar

Tự động gom job remote / freelance từ các nguồn **có API công khai**, chấm điểm theo kỹ năng của bạn, hiển thị trên trang web `http://localhost:4321` và báo job mới qua Telegram.

Cần Node.js 22.5 trở lên và một database Postgres (dùng [Neon](https://neon.tech) miễn phí). Mọi kết quả AI được lưu theo id job trong database, nên mỗi job chỉ gọi AI một lần cho mỗi loại kết quả.

## Chạy trên máy

1. `cp server/.env.example server/.env`, dán connection string của Neon vào `DATABASE_URL=`. Nên tạo một branch `dev` trên Neon để dùng ở máy, tách khỏi dữ liệu thật.
2. Cài thư viện và chạy:

```bash
npm install
npm start
```

Trên Windows PowerShell, nếu báo "running scripts is disabled", dùng `npm.cmd install` và `npm.cmd start`.

Sau đó mở http://localhost:4321 (landing page), http://localhost:4321/app/ (ứng dụng) hoặc http://localhost:4321/classic (trang một người dùng cũ). Server tự quét mỗi 60 phút (mỗi nguồn có giới hạn riêng trong `server/config.json` để không gọi API quá nhiều). Nút **Quét ngay** quét tất cả ngay lập tức.

Chỉ quét một lần, không mở web: `npm run fetch`

Các lệnh `npm ...` trong README đều chạy ở **thư mục gốc** của repo. File `.env`, `profile.md`, `server/config.json` và `data/` nằm trong thư mục `server/`.

### Ứng dụng mới: tài khoản người dùng và admin

Ứng dụng mới chạy song song với trang cũ:

- **http://localhost:4321/app/**: đăng ký bằng email/mật khẩu hoặc Google, xác minh email, quên mật khẩu, đồng ý điều khoản, trang Tài khoản (đổi tên, mật khẩu, tải dữ liệu, xoá tài khoản), Điều khoản và Chính sách quyền riêng tư.
- **http://localhost:4321/admin/**: danh sách người dùng. Chỉ email có trong `ADMIN_EMAILS` vào được.

Trang cũ ở `/` vẫn dùng `APP_PASSWORD` như trước cho tới khi ứng dụng mới có đủ tính năng.

Mỗi tài khoản có **hồ sơ riêng** (kỹ năng chọn từ danh mục hoặc từ khoá tự đặt, từ khoá muốn loại trừ, ngân sách tối thiểu, đoạn giới thiệu cho AI) và **trạng thái job riêng** (lưu, ẩn, đã nộp, điểm AI, bộ apply). Điểm từ khoá được tính theo hồ sơ mỗi khi mở danh sách job, nên mọi người dùng chung một kho job mà vẫn thấy thứ tự riêng. Tóm tắt "10 điểm chính" là theo job nên dùng chung cho mọi người.

**Trang job (`/app/`):** các tab Mới, Đã lưu, Đã nộp, Đã ẩn; tìm kiếm, xếp theo mức phù hợp / mới nhất / điểm từ khoá, lọc theo nguồn và "chỉ nhận người ở VN". Mỗi job hiện điểm (điểm AI nếu đã chấm), ngân sách, số bid, kỹ năng khớp, cảnh báo lừa đảo, 10 điểm chính (tải khi cuộn tới) và mô tả gốc; nút Chuẩn bị apply (bộ apply có nút Copy cho từng phần), AI chấm, Lưu, Đã nộp, Ẩn.

**Gói dịch vụ:** tài khoản mới được **Dùng thử 7 ngày** mọi tính năng, sau đó về **Free**, hoặc **Pro** (79.000đ/tháng).
- Free: danh sách job cá nhân, lưu/ẩn/đã nộp, tối đa 20 tóm tắt mới mỗi ngày, bản tin hằng ngày trên channel Telegram chung.
- Dùng thử và Pro: thêm AI chấm, bộ apply, tóm tắt không giới hạn, Telegram riêng (báo job hợp hồ sơ, có giờ nghỉ và bản tin đầu ngày). Giới hạn dùng hợp lý: 200 lần AI chấm và 40 bộ apply mỗi ngày.
- Admin (`ADMIN_EMAILS`) luôn có đủ tính năng và cộng được ngày Pro cho người dùng trong trang admin.
- **Thanh toán chưa nối với cổng thật:** `BILLING_MODE=mock` (mặc định) hiện thông tin chuyển khoản mẫu và nút "xác nhận (thử nghiệm)" bật Pro 30 ngày, không thu tiền. Mọi lần bật Pro được ghi vào bảng `payments`.

**Telegram cho người dùng app:** trong mục Telegram, người dùng Pro bấm "Liên kết Telegram", mở bot và bấm Start (mã một lần, hiệu lực 15 phút, chỉ nhận trong chat riêng). Sau mỗi lượt quét, mỗi người nhận tối đa 5 job mới hợp hồ sơ của họ. Channel chung (`TELEGRAM_CHANNEL_ID`) nhận một bản tin mỗi ngày sau `CHANNEL_DIGEST_HOUR` giờ (giờ Việt Nam): tối đa 15 job nhận người Việt, chia theo lĩnh vực, kèm link đăng ký. Bot phải là admin của channel. Thông báo cũ qua `TELEGRAM_CHAT_ID` vẫn chạy cho tới khi bạn xoá biến đó.

**Báo cáo job và trang admin:** mỗi job có nút "⚑ Báo cáo" (lừa đảo, hết hạn/link hỏng, sai thông tin, nhờ kiểm tra), tối đa 20 báo cáo/người/ngày. Trong `/admin/`:
- **Báo cáo job:** đánh dấu *Lừa đảo* (job biến mất khỏi danh sách Mới, Telegram và channel của mọi người; ai đã lưu thì vẫn thấy kèm cảnh báo), *Đã xác minh* (job có huy hiệu ✓), hoặc *Bỏ qua*. Quyết định đóng mọi báo cáo đang mở của job đó.
- **Nguồn job:** lần gọi cuối, lỗi nếu có, số job lấy về, số job mới trong 24 giờ.
- **Chi phí AI:** số lần gọi và token theo loại việc, theo model và theo người dùng (24 giờ / 7 ngày / 30 ngày). Muốn thấy tiền, điền giá vào `ai.pricing` trong `server/config.json`: `{"<model>": {"input": <USD/1 triệu token>, "output": <USD/1 triệu token>}}` theo bảng giá hiện tại của Google.
- **Thanh toán:** lịch sử bật Pro; doanh thu thật không tính thanh toán thử nghiệm.

**Trang công khai, blog và quảng cáo:**
- `/` là landing page (render ở server để Google đọc được). Trang một người dùng cũ chuyển sang **`/classic`**, vẫn đăng nhập bằng `APP_PASSWORD`.
- Blog: viết trong `/admin/` → Blog (Markdown, có xem trước, nháp/đăng, đường dẫn tự tạo từ tiêu đề). Bài đăng ở `/blog/<đường-dẫn>`, có trong `/sitemap.xml`. `robots.txt` chặn `/app/`, `/admin/`, `/api/`. Nội dung bài luôn được escape: không chèn được HTML hay script.
- Quảng cáo: ô trên landing, blog, trong bài, và trong danh sách job của gói Free (cứ 8 job một ô). Gói Pro không có quảng cáo. Chưa đặt `ADSENSE_CLIENT` thì các ô hiện giới thiệu của JobRadar (gói Pro, channel). Có `ADSENSE_CLIENT` thì người xem thấy banner hỏi ý; script của Google **chỉ tải sau khi họ bấm Đồng ý**. `/ads.txt` được tạo tự động. Chính sách quyền riêng tư đã có mục quảng cáo, nên mọi người dùng được hỏi đồng ý lại điều khoản một lần.

**Tạo hồ sơ (onboarding):** sau khi đăng ký, người dùng chọn một trong hai cách: trả lời bảng hỏi (lĩnh vực và mức độ, số năm kinh nghiệm, tiếng Anh, hình thức làm việc, mức giá, từ khoá thêm/loại trừ, giới thiệu ngắn), hoặc tải CV dạng PDF (tối đa 2 MB). Với CV, người dùng phải tích đồng ý gửi CV cho Gemini; AI đọc CV và điền sẵn bảng hỏi để người dùng kiểm tra rồi mới lưu. Mỗi người phân tích CV tối đa 5 lần/ngày. CV được lưu trong database; người dùng tải về hoặc xoá được trong trang Hồ sơ.

Lần đầu một admin mở ứng dụng mới, dữ liệu của bản một người dùng được chuyển sang tài khoản đó: trạng thái job, điểm AI và bộ apply đã có, kỹ năng trong `server/config.json` và nội dung `profile.md`.

Server phục vụ bản đã build của hai ứng dụng, nên chạy `npm run build` một lần (và sau mỗi lần sửa giao diện). Khi đang sửa giao diện, chạy thêm các lệnh sau trong terminal khác để trang tự cập nhật (server vẫn chạy bằng `npm start`):

```bash
npm run dev:client
```

```bash
npm run dev:admin
```

Client mở ở http://localhost:5173/app/, admin ở http://localhost:5174/admin/. Chúng tự chuyển các lời gọi `/api` sang server ở cổng 4321.

Các biến môi trường mới (xem `server/.env.example`): `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `LEGAL_OPERATOR`, `CONTACT_EMAIL`. Thiếu Google thì nút Google bị ẩn; thiếu Resend thì không gửi email (chạy trên máy thì liên kết được in ra log).

**Đăng nhập Google:** trong Google Cloud Console → APIs & Services → Credentials, tạo OAuth client loại *Web application*, thêm Authorized redirect URI `<PUBLIC_URL>/api/auth/google/callback` (trên máy: `http://localhost:4321/api/auth/google/callback`). Màn hình đồng ý OAuth chỉ cần các quyền `openid`, `email`, `profile`.

**Điều khoản và chính sách** được viết theo Luật Bảo vệ dữ liệu cá nhân của Việt Nam, nhưng nên nhờ người có chuyên môn pháp lý đọc lại trước khi thu tiền. Khi sửa nội dung, tăng `TERMS_VERSION` trong `server/src/accounts.js`: mọi người dùng sẽ được hỏi đồng ý lại.

## Bật Telegram

1. Trong Telegram, nhắn cho **@BotFather** → `/newbot` → đặt tên → nhận **token**.
2. `cp server/.env.example server/.env` (nếu chưa có) rồi dán token vào dòng `TELEGRAM_BOT_TOKEN=`.
3. Mở bot vừa tạo trong Telegram, gửi cho nó một tin bất kỳ (ví dụ "hi").
4. Chạy `npm run telegram:chatid`, rồi copy dòng `TELEGRAM_CHAT_ID=...` vào `.env`.
5. Khởi động lại `npm start`.

Mỗi lần quét, bot gửi tối đa 10 job có điểm ≥ 25, đăng trong 48 giờ gần nhất và nhận người ở Việt Nam, kèm một tin "…và còn N job" nếu còn dư. Mỗi job chỉ được gửi một lần. Nếu Telegram lỗi giữa chừng, job chưa gửi được sẽ thử lại ở lượt quét sau (miễn là chưa quá 48 giờ). Bạn chỉnh các ngưỡng này trong mục `telegram` của `server/config.json`.

**Giờ nghỉ:** bấm **⚙️ Telegram** trên trang. Mặc định bot không gửi tin từ 00:00 đến 06:00 (giờ Việt Nam). Job phù hợp tìm được trong giờ nghỉ được giữ lại và gửi thành **một danh sách** ở lượt quét đầu tiên sau giờ nghỉ (với cron mỗi 60 phút: trong khoảng 06:00–07:00). Danh sách hiện tối đa 20 job, còn lại thì ghi số lượng. Bạn đổi giờ hoặc tắt giờ nghỉ ngay trong hộp đó; cài đặt được lưu trong database và tính theo múi giờ của trình duyệt lúc bạn bấm Lưu.

**Kiểm tra kết nối:** bấm **⚙️ Telegram → 📨 Gửi tin thử** trên trang. Bot gửi một tin xác nhận kèm job tốt nhất hiện có. Nếu cấu hình sai, trang báo rõ lỗi (token sai, chat id sai, bạn đã chặn bot…).

**Bot trả lời `/start`** khi JobRadar chạy online (`PUBLIC_URL` bắt đầu bằng `https://`): lúc khởi động, server tự đăng ký webhook với Telegram. Nhắn `/start` từ chat đã cấu hình, bot xác nhận đã kết nối; từ chat khác, bot trả lời chat id của chat đó. Khi đã có webhook, `npm run telegram:chatid` không đọc được tin nhắn nữa: thay vào đó, nhắn `/start` để lấy chat id. Chạy trên máy (không có https) thì bot không trả lời, nhưng vẫn gửi job bình thường.

`.env` chứa token: đừng commit hay gửi file này cho ai.

## Bật AI (Gemini, miễn phí)

1. Vào https://aistudio.google.com → **Get API key** → tạo key. Dùng project **không gắn thẻ thanh toán** để chắc chắn ở gói miễn phí.
2. Dán key vào `.env` ở dòng `GEMINI_API_KEY=`.
3. **Tạo và điền `profile.md`**: `cp server/profile.example.md server/profile.md`. File này không được đưa lên git vì chứa thông tin cá nhân. AI chỉ dùng thông tin trong file này để chấm job và viết proposal. Chỗ nào bạn chưa điền, AI để lại `[điền ...]` chứ không bịa.
4. Khởi động lại `npm start`.

AI làm gì:
- **Chấm điểm**: sau mỗi lần quét, tối đa 30 job được Gemini đọc (10 job/lần gọi) và chấm 0–100, kèm lý do và cảnh báo lừa đảo. Job đang chờ báo Telegram được đọc trước, sau đó mới tới các job cũ có điểm từ khoá cao nhất. Telegram khi đó chỉ gửi job AI chấm ≥ 60 và không bị nghi lừa đảo; job AI chưa kịp đọc thì chờ lượt sau.
- **10 điểm chính**: khi bạn cuộn tới job nào, AI tóm tắt mô tả dài thành tối đa 10 gạch đầu dòng tiếng Việt, hiện ngay phía trên mô tả gốc (mô tả gốc vẫn giữ). Chỉ các job đang hiện trên màn hình mới được tóm tắt, tối đa 10 job/lần gọi; lướt nhanh qua thì không tốn lượt. Kết quả được lưu, lần sau hiện ngay.
- **✍️ AI chuẩn bị apply** (nút trên mỗi job): viết proposal/cover letter, giá bid + thời gian giao, milestones, câu trả lời cho các câu hỏi thường gặp trong form, câu nên hỏi lại khách, điểm mạnh để đưa vào CV, và danh sách những gì bạn phải tự điền. Mỗi mục có nút Copy. Kết quả được lưu lại; bấm **Viết lại** để có bản khác.

Đọc lại trước khi gửi: AI có thể sai. Ở gói miễn phí, Google có thể dùng nội dung gửi lên để cải thiện sản phẩm — đừng đưa thông tin nhạy cảm vào `profile.md`. Chỉnh model/giới hạn trong mục `ai` của `server/config.json`: `fastModels` dùng cho chấm điểm và 10 điểm chính (model nhanh trước), `models` dùng cho bộ apply (model tốt trước). Model nào quá tải hoặc quá chậm thì bỏ qua ngay và dùng model kế tiếp.

## Nguồn dữ liệu

| Nguồn | Loại việc | Ghi chú |
|---|---|---|
| Freelancer.com | Freelance theo dự án / theo giờ | Có ngân sách và số người đã bid. Tìm theo `freelancerQueries`, cộng thêm mọi dự án viết bằng tiếng Việt (nhãn **Khách Việt**, +10 điểm) |
| Remotive | Full-time remote | Dữ liệu trễ 24h, tối đa 4 lần/ngày |
| Remote OK | Remote | ~100 job mới nhất |
| Himalayas | Remote | 100 job mới nhất, cộng thêm tìm kiếm chỉ trong các job **nhận người ở Việt Nam** theo `himalayasVietnamQueries` |
| Jobicy | Remote | 50 job mới nhất + 50 job khu vực APAC |
| We Work Remotely | Remote | RSS chính thức |

Các nguồn này yêu cầu dẫn link về trang gốc; JobRadar luôn làm vậy.

**Không có:** ITviec, TopCV, vLance chặn truy cập tự động bằng Cloudflare; TopDev cấm robot dùng API (`api.topdev.vn/robots.txt`) và chặn request không phải trình duyệt. JobRadar không vượt qua các cơ chế chống bot này — hãy bật thông báo email ngay trên các trang đó.

**Upwork không có trong danh sách** vì Upwork đã tắt RSS (08/2024) và điều khoản cấm cào trang hoặc theo dõi liên tục. Với Upwork, dùng *Saved search* + thông báo email trên chính Upwork.

## Đưa lên mạng: Render + Neon + cron job

Server trên Render bản miễn phí sẽ **ngủ** sau khoảng 15 phút không ai truy cập và **không giữ file** giữa các lần deploy. Vì vậy dữ liệu nằm trên Neon, còn việc quét định kỳ do cron job gọi từ bên ngoài. Lần đầu mở trang sau khi server ngủ phải chờ khoảng 30–60 giây.

### 1. Neon

1. Tạo **project mới** (hoặc ít nhất một database riêng), đừng dùng chung database với trang web khác.
2. Vào **Connect**, chọn connection string loại **pooled**, copy lại để dùng cho `DATABASE_URL`.
3. Bảng được tạo tự động khi server chạy lần đầu.
4. Muốn mang dữ liệu cũ (kể cả kết quả AI) từ `server/data/jobs.sqlite` lên: đặt `DATABASE_URL` trong `.env` ở máy rồi chạy `npm run migrate`. Chạy lại nhiều lần cũng không bị trùng.

### 2. Render

1. **New → Web Service**, chọn repo này.
2. Build command: `npm ci && npm run build` (build cả ứng dụng người dùng và admin). Start command: `npm start`. Instance type: Free.
3. Phần **Environment**, thêm các biến:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | connection string của Neon |
| `APP_PASSWORD` | mật khẩu vào trang, ít nhất 8 ký tự (bắt buộc, thiếu thì server không chạy) |
| `SESSION_SECRET` | chuỗi ngẫu nhiên dài (tuỳ chọn) |
| `CRON_SECRET` | chuỗi ngẫu nhiên dài, dùng cho cron job |
| `PUBLIC_URL` | địa chỉ Render cấp, ví dụ `https://jobradar.onrender.com` |
| `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | như khi chạy trên máy (tuỳ chọn) |

4. Phần **Secret Files**, thêm file tên `profile.md` với nội dung hồ sơ của bạn (file này không có trong git).
5. Health check path: `/healthz`.

Tạo chuỗi ngẫu nhiên: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Cron job (ví dụ cron-job.org)

- URL: `https://<địa-chỉ-render>/api/cron/scan`, method GET hoặc POST.
- Header: `Authorization: Bearer <CRON_SECRET>`. Dịch vụ cron nào không cho thêm header thì dùng `?key=<CRON_SECRET>` ở cuối URL.
- Lịch: mỗi 60 phút.

Endpoint trả lời ngay (`202`) rồi quét ở nền, nên cron không bị quá thời gian chờ. Hai lần gọi chồng nhau thì chỉ có một lượt quét. Mỗi nguồn vẫn giữ giới hạn riêng trong `server/config.json`.

Lưu ý: số giờ chạy miễn phí của Render tính chung cho cả tài khoản. Nếu bạn còn web service miễn phí khác, đừng cài cron dày hơn mức cần để giữ server thức suốt ngày.

### Dọn dữ liệu

Sau mỗi lượt quét, job ở tab Mới / Đã ẩn mà không nguồn nào còn đăng trong `retentionDays` ngày (mặc định 60, trong `server/config.json`) sẽ bị xoá để database không vượt gói miễn phí. Job đã **Lưu** hoặc **Đã nộp** được giữ lại cùng kết quả AI.

## Chỉnh cho đúng ý bạn — `server/config.json`

- `skills`: nhóm kỹ năng, từ khoá và trọng số. Khớp ở tiêu đề được nhân 2, ở tag tính 1, chỉ trong mô tả thì tính nửa và cần ít nhất 2 từ khoá.
- `excludeTitleTerms`: tiêu đề chứa các từ này bị trừ điểm mạnh.
- `regionOkTerms`: job có giới hạn khu vực không chứa các từ này sẽ bị coi là "không nhận người ở VN" (bị trừ 30 điểm và làm mờ).
- `freelancerQueries`: các từ khoá dùng để tìm trên Freelancer.com.
- `minBudgetUsd`: job có ngân sách thấp hơn mức này bị trừ điểm.

Điểm cộng thêm: job freelance (+5), dưới 10 người bid (+5), đăng trong 24 giờ (+5).

## Cấu trúc

Một repo, ba phần, quản lý bằng npm workspaces:

```
server/                    API, quét job, AI, Telegram (Node.js, Postgres)
  src/sources.js           lấy job từ từng nguồn, chuẩn hoá về một dạng
  src/score.js             chấm điểm theo config.json
  src/settings.js          cài đặt đổi từ trang web (giờ nghỉ Telegram), lưu trong database
  src/db.js                lưu vào Postgres (Neon), kể cả kết quả AI theo id job
  src/run.js               một lượt quét + gửi Telegram
  src/server.js            trang web, đăng nhập, endpoint cho cron + lịch quét khi server thức
  src/migrate-sqlite.js    chép dữ liệu cũ từ data/jobs.sqlite sang Postgres
  src/accounts.js          tài khoản: mật khẩu (scrypt), phiên đăng nhập, liên kết gửi qua email
  src/routes-account.js    API đăng ký, đăng nhập, Google, đồng ý điều khoản, dữ liệu của tôi, admin
  src/email.js             gửi email tài khoản qua Resend
  src/static.js            phục vụ bản build của client (/app/) và admin (/admin/)
  src/profiles.js          hồ sơ từng người: danh mục kỹ năng, chấm điểm theo hồ sơ, chuyển dữ liệu cũ
  src/routes-feed.js       API danh sách job cá nhân, lưu/ẩn/đã nộp, điểm AI và bộ apply theo người
  src/highlights.js        tóm tắt 10 điểm chính, dùng chung mọi người
  src/http.js              tiện ích HTTP dùng chung (cookie, JSON, giới hạn tần suất)
  src/billing.js           gói Pro, thanh toán (thử nghiệm), lịch sử thanh toán
  src/telegram-users.js    liên kết Telegram theo người, báo job riêng, bản tin channel
  src/reports.js           báo cáo job, quyết định của admin, thống kê nguồn và mức dùng AI
  src/public-pages.js      landing page, blog, sitemap, robots.txt, ads.txt, ô quảng cáo
  src/blog.js              bài viết blog
  src/markdown.js          chuyển Markdown thành HTML an toàn
  public/index.html        giao diện hiện tại (sẽ được thay bằng frontend/client)
  config.json              nguồn, kỹ năng, ngưỡng điểm, AI, Telegram
frontend/
  shared/                  màu sắc (sáng/tối) và component dùng chung
  client/                  ứng dụng cho người dùng, chạy ở /app/ (React + Vite + Tailwind)
  admin/                   trang quản trị, chạy ở /admin/
```
