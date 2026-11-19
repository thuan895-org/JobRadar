# JobRadar

Tự động gom job remote / freelance từ các nguồn **có API công khai**, chấm điểm theo kỹ năng của bạn, hiển thị trên trang web `http://localhost:4321` và báo job mới qua Telegram.

Chỉ cần Node.js 22.5 trở lên, không cần `npm install`.

## Chạy

```bash
cd ~/FREE/JobRadar
npm start
```

Sau đó mở http://localhost:4321. Server tự quét mỗi 60 phút (mỗi nguồn có giới hạn riêng trong `config.json` để không gọi API quá nhiều). Nút **Quét ngay** quét tất cả ngay lập tức.

Chỉ quét một lần, không mở web: `npm run fetch`

## Bật Telegram

1. Trong Telegram, nhắn cho **@BotFather** → `/newbot` → đặt tên → nhận **token**.
2. `cp .env.example .env` rồi dán token vào dòng `TELEGRAM_BOT_TOKEN=`.
3. Mở bot vừa tạo trong Telegram, gửi cho nó một tin bất kỳ (ví dụ "hi").
4. Chạy `npm run telegram:chatid`, rồi copy dòng `TELEGRAM_CHAT_ID=...` vào `.env`.
5. Khởi động lại `npm start`.

Mỗi lần quét, bot gửi tối đa 10 job mới có điểm ≥ 25, đăng trong 48 giờ gần nhất và nhận người ở Việt Nam. Bạn chỉnh các ngưỡng này trong mục `telegram` của `config.json`.

`.env` chứa token: đừng commit hay gửi file này cho ai.

## Bật AI (Gemini, miễn phí)

1. Vào https://aistudio.google.com → **Get API key** → tạo key. Dùng project **không gắn thẻ thanh toán** để chắc chắn ở gói miễn phí.
2. Dán key vào `.env` ở dòng `GEMINI_API_KEY=`.
3. **Tạo và điền `profile.md`**: `cp profile.example.md profile.md`. File này không được đưa lên git vì chứa thông tin cá nhân. AI chỉ dùng thông tin trong file này để chấm job và viết proposal. Chỗ nào bạn chưa điền, AI để lại `[điền ...]` chứ không bịa.
4. Khởi động lại `npm start`.

AI làm gì:
- **Chấm điểm**: sau mỗi lần quét, tối đa 30 job có điểm từ khoá cao nhất được Gemini đọc (10 job/lần gọi) và chấm 0–100, kèm lý do và cảnh báo lừa đảo. Telegram khi đó chỉ gửi job AI chấm ≥ 60 và không bị nghi lừa đảo.
- **10 điểm chính**: khi bạn cuộn tới job nào, AI tóm tắt mô tả dài thành tối đa 10 gạch đầu dòng tiếng Việt, hiện ngay phía trên mô tả gốc (mô tả gốc vẫn giữ). Chỉ các job đang hiện trên màn hình mới được tóm tắt, tối đa 10 job/lần gọi; lướt nhanh qua thì không tốn lượt. Kết quả được lưu, lần sau hiện ngay.
- **✍️ AI chuẩn bị apply** (nút trên mỗi job): viết proposal/cover letter, giá bid + thời gian giao, milestones, câu trả lời cho các câu hỏi thường gặp trong form, câu nên hỏi lại khách, điểm mạnh để đưa vào CV, và danh sách những gì bạn phải tự điền. Mỗi mục có nút Copy. Kết quả được lưu lại; bấm **Viết lại** để có bản khác.

Đọc lại trước khi gửi: AI có thể sai. Ở gói miễn phí, Google có thể dùng nội dung gửi lên để cải thiện sản phẩm — đừng đưa thông tin nhạy cảm vào `profile.md`. Chỉnh model/giới hạn trong mục `ai` của `config.json`: `fastModels` dùng cho chấm điểm và 10 điểm chính (model nhanh trước), `models` dùng cho bộ apply (model tốt trước). Model nào quá tải hoặc quá chậm thì bỏ qua ngay và dùng model kế tiếp.

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

## Chỉnh cho đúng ý bạn — `config.json`

- `skills`: nhóm kỹ năng, từ khoá và trọng số. Khớp ở tiêu đề được nhân 2, ở tag tính 1, chỉ trong mô tả thì tính nửa và cần ít nhất 2 từ khoá.
- `excludeTitleTerms`: tiêu đề chứa các từ này bị trừ điểm mạnh.
- `regionOkTerms`: job có giới hạn khu vực không chứa các từ này sẽ bị coi là "không nhận người ở VN" (bị trừ 30 điểm và làm mờ).
- `freelancerQueries`: các từ khoá dùng để tìm trên Freelancer.com.
- `minBudgetUsd`: job có ngân sách thấp hơn mức này bị trừ điểm.

Điểm cộng thêm: job freelance (+5), dưới 10 người bid (+5), đăng trong 24 giờ (+5).

## Cấu trúc

```
src/sources.js   lấy job từ từng nguồn, chuẩn hoá về một dạng
src/score.js     chấm điểm theo config.json
src/db.js        lưu vào data/jobs.sqlite (SQLite có sẵn trong Node)
src/run.js       một lượt quét + gửi Telegram
src/server.js    trang web + lịch quét tự động
public/index.html giao diện
```
