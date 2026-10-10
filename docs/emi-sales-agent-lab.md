# EMI SALES AGENT LAB

Lab độc lập để xây và đánh giá bộ não sale Emi House. OpenAI đọc toàn bộ context, diễn giải ý định, cập nhật memory và đề xuất câu trả lời. Code không phân loại khách bằng keyword, không state machine sale, không tự fine-tune. Lab chạy **local**, không deploy lên project Messenger.

## Mở Lab

Cần Node.js **24.14+** (đã kiểm tra trên 24.14.1), dependencies hiện có (`npm ci` nếu chưa có).

1. Sao chép `lab/.env.example` thành `lab/.env.local`.
2. Điền `OPENAI_API_KEY` trong file local hoặc export environment ở terminal. Không đưa key vào UI/Git.
3. Chạy `npm run lab` tại thư mục project.
4. Mở <http://127.0.0.1:4317>.

`EMI_LAB_PORT` đổi cổng. Model mặc định được lấy theo thứ tự: `EMI_LAB_MODEL` → `OPENAI_MODEL` → `lab/config.json.default_model`. UI cho nhập Model ID cho từng lượt/replay; quyền model và hỗ trợ Structured Outputs phụ thuộc tài khoản OpenAI. Key chỉ đọc phía server. Sửa environment, persona hoặc catalog thì restart server; UI model đổi trực tiếp.

Nếu thiếu key, UI báo rõ; không dùng câu trả lời giả làm fallback. Các lượt bị từ chối, incomplete, lỗi API/schema/evidence không được áp dụng vào hội thoại hoặc memory. Lỗi API được rút gọn để không lộ credential.

## Thao tác

- Chọn/tạo customer test, chọn Product hoặc Ads giả lập rồi **New Conversation**. Hồ sơ khách chỉ chứa dữ liệu test đã biết.
- Gửi tin như Messenger: Enter gửi, Shift+Enter xuống dòng. Tin gửi gần nhau được gom trong cửa sổ 650ms, tối đa 30 tin/lượt. Tin gửi khi model đang chạy xếp vào lượt tiếp theo. Gửi lỗi sẽ trả tin chưa xử lý về ô soạn.
- Đổi Product/Ads ngay trong hội thoại để thử chuyển mẫu. Model vẫn đọc các mẫu, lịch sử và memory; entry Ads không khóa mẫu đang tư vấn.
- Chọn câu Agent trong chat hoặc chọn lượt ở AI Brain để xem kết luận và memory sau **lượt đó**. Memory có subject người mặc, FACT/INFERENCE, evidence và Message ID.
- **GOOD** lưu đánh giá. **EDIT** yêu cầu câu sale thật; **BAD** cho nhập lỗi. EDIT/BAD tự tạo case từ snapshot của lượt lỗi. Không tự biến feedback thành luật hoặc ghi đè lịch sử chat.
- **Lưu test case** lưu input/context của lượt đã chọn và kỳ vọng. **Reset** xóa lịch sử/memory hiện tại; các run/feedback/case đã lưu vẫn còn. **New Conversation** tạo cuộc mới, memory mới; không âm thầm mang suy luận từ cuộc cũ sang khách.
- Case: chọn case, đổi model phía trên, **Chạy lại**. Lịch sử, tin mục tiêu, hồ sơ, entry, memory và catalog giữ nguyên snapshot. Các output model nằm cạnh nhau bên dưới. CHAT TEST hiển thị snapshot chỉ đọc; chọn New Conversation để chat tiếp. Replay là kiểm thử đúng một lượt trên cùng prefix hội thoại, không tái sinh toàn bộ prefix bằng model mới.
- **Chạy toàn bộ case** gọi API một lần mỗi case; mặc định có 22 case. Trạng thái “output hợp lệ” là đạt API/schema/provenance, chưa khẳng định đúng chất lượng sale. Cần người chấm GOOD/EDIT/BAD.
- **Xuất dữ liệu** xuất JSON gồm catalog, case, input/output, memory, đánh giá, model, usage, timestamp và version. **Import JSON** nhận một case, mảng case hoặc trường `cases` của export. Import chỉ nhận case; không ghi đè run/customer/hội thoại. Xem `lab/import-example.json`. Import nhiều case được lưu lần lượt; nếu case lỗi, các case trước đó vẫn còn.

## Audit và kiến trúc

Project gốc dùng Node ESM, OpenAI SDK, Supabase, ba Vercel API (`webhook`, `products`, `facebook-ads`) và giao diện HTML/JS. Workflow dashboard là Next.js riêng. Messenger hiện chạy giới thiệu sản phẩm theo Ads rồi bàn giao nhân viên; chức năng preview hiện tại chạy kịch bản giới thiệu, không phải bộ não sale.

Chọn server Node riêng vì tái sử dụng được runtime/SDK/HTML mà không thêm Vercel function, không sửa webhook hay đưa credentials Supabase/Page vào Lab. Lab chỉ bind `127.0.0.1`, kiểm tra Host/Origin, JSON content-type, body limit, CSP và escape dữ liệu UI.

```text
Browser localhost → lab/server.js → lab/service.js
                                    ├─ brain.js → OpenAI Responses API
                                    └─ store.js → lab/data/emi-sales-lab.sqlite
```

File bổ sung:

| File | Vai trò |
| --- | --- |
| `lab/server.js` | Static UI và `/lab-api/*`, localhost riêng |
| `lab/service.js` | Hội thoại, batching, khóa theo conversation, atomic commit, feedback, replay |
| `lab/brain.js` | Gọi OpenAI, xử lý lỗi/refusal/incomplete, không có tools |
| `lab/schema.js` | Schema ổn định và validation runtime/provenance/product ID |
| `lab/persona.js` | Persona và instructions có version, tách shop facts và reasoning |
| `lab/catalog.json` | Bốn sản phẩm và hai Ads giả lập; stock/policy thiếu là null |
| `lab/config.json` | Model mặc định, cổng, timeout, giới hạn context/output |
| `lab/store.js` | Database SQLite riêng, migration idempotent khi startup |
| `lab/fixtures.js` | 22 snapshot case nền |
| `lab/evaluation.js`, `lab/evaluate.js` | CLI replay và rubric regression của các case trọng yếu |
| `lab/web/*` | CHAT TEST, AI BRAIN, Sales Memory, feedback, case và comparison |
| `lab/import-example.json`, `lab/.env.example` | Mẫu import và cấu hình |
| `test/emi-sales-lab.test.js` | Kiểm thử cô lập, HTTP, SDK request, persistence và regression checker |

Chỉ sửa `package.json` để thêm script và `.gitignore` để bỏ qua SQLite. **Không sửa** `api/`, `server/`, `public/`, `sql/`, workflow dashboard, webhook URL hoặc cấu hình production. Không có migration Supabase.

Database có `lab_meta`, `lab_customers`, `lab_conversations`, `lab_runs`, `lab_feedback`, `lab_cases`. Các record lưu JSON có ID độc lập. SQLite, WAL, SHM và environment đều không commit. `lab_runs` giữ snapshot đầy đủ và version; `lab_feedback` giữ input/context + output + rating + câu sửa + thời gian/model/version. Memory thuộc hội thoại, có người nhận và provenance; không dùng làm source of truth về giá, stock, sale.

## Structured Output và giới hạn

Các trường chính: `understanding`, `current_product_id`, `referenced_products`, `new_facts`, `memory_updates`, `concerns`, `purchase_intent`, `next_best_action`, `missing_information`, `uncertainties`, `human_needed`, `suggested_reply`.

`purchase_intent.transactions` tách source/target/action/quantity/confirmation. Exchange là một thao tác có nguồn và đích; add là thao tác khác. Những thao tác này **không** thực thi đơn hàng. Chỉ xuất kết luận, không yêu cầu hay hiển thị chain-of-thought.

Memory phân biệt `customer`, `recipient:mother`, `recipient:other`, `product:LAB-*`; phân biệt fact/inference và recommended_size/selected_size. Model quyết định các cập nhật. Server kiểm tra schema, ID và trích dẫn evidence có thật trong tin tương ứng; fact chỉ lấy từ lời khách/hồ sơ. Không dùng regex để hiểu ý định mua hay tạo reply. Runtime validation không chứng minh suy luận đúng hoặc mọi câu tự nhiên đều đúng shop facts; điều này phải đánh giá bằng case thật và người sale. Ví dụ model có thể trích đúng evidence nhưng diễn giải sai người mặc: rubric phát hiện ở case người mẹ.

Catalog của snapshot là nguồn dữ liệu trong replay để so sánh công bằng. Chat mới dùng catalog hiện tại từ file. Không tự nạp sản phẩm/customer/order production. Hội thoại tối đa 160 message, không âm thầm cắt context; vượt giới hạn cần lưu case và mở cuộc mới. Database local thiết kế cho một process Lab; không chạy nhiều server cùng cổng/database.

Theo [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), Responses API dùng `text.format` với JSON Schema `strict`; mọi property được required, `additionalProperties:false`. Request đặt `store:false` và không khai báo tools. Không trả reasoning trace về UI.

## Kiểm thử / evaluation thật

```sh
npm run test:lab
npm test
npm run lab:evaluate -- --model YOUR_MODEL_ID
npm run lab:evaluate -- --model YOUR_MODEL_ID --case seed-exchange-uncertain
```

Test unit/integration dùng mock, không gửi Messenger hoặc gọi OpenAI trả phí. CLI evaluation cần key thật, gọi OpenAI, lưu run để xem trong UI. Rubric trọng yếu kiểm tra người mẹ, cân nặng 53, ok/khen màu chưa tự xác nhận, chuyển Ads A sang mẫu B, exchange+add và uncertainty của mẫu xanh. Các rubric chỉ đánh giá output, không tham gia quyết định câu trả lời. Case còn lại cần human review; pass rubric không đồng nghĩa đủ chất lượng production.

Kết quả triển khai: **120/120 test pass**, HTTP/browser đã kiểm tra bằng harness output mô phỏng và SQLite riêng trong RAM. Browser thực xác minh thiếu key báo lỗi, hội thoại vẫn 0 tin, không có output/memory giả. Chưa chạy 22 case với OpenAI thật vì môi trường chưa có `OPENAI_API_KEY`; chưa chứng nhận chất lượng sale của model. Không deploy và không gọi dịch vụ Messenger/Supabase thật trong kiểm thử.
