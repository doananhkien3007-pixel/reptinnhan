# EMI SALES AGENT LAB

Lab độc lập về dữ liệu và luồng xử lý để xây, thử và đánh giá bộ não sale Emi House. OpenAI đọc toàn bộ context, diễn giải ý định, cập nhật memory và đề xuất câu trả lời. Code không phân loại khách bằng keyword, không state machine sale, không tự fine-tune.

## Lab trên website LeafChat

Mở `/lab` trên cùng website LeafChat hoặc chọn **AI Sale Lab** ở thanh bên. Đây là một trang test riêng, nhưng dùng chung domain, giao diện và project Vercel hiện tại. API riêng nằm tại `/api/lab`; webhook Messenger, đơn hàng, tồn kho và bảng sản phẩm production không được gọi.

Nút **AI Assistant → Cấu hình trợ lý AI** trong Lab cho phép chọn model và nhập hướng dẫn bổ sung cho Emi. Cấu hình được chụp cùng lúc tạo hội thoại và lưu trong chính record Lab để mỗi kết quả có thể tái kiểm tra. Thay đổi khi đang mở một hội thoại chỉ áp dụng cho hội thoại mới, tránh đổi hành vi giữa chừng. Hướng dẫn bổ sung được đặt sau persona nền và không được ghi đè quy tắc trung thực, shop facts, schema hoặc bảo mật. Cấu hình này không đọc hay ghi System Prompt của bot Messenger.

Server đọc `OPENAI_API_KEY`, `OPENAI_MODEL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` và `EMI_LAB_SESSION_SECRET` từ Vercel. Browser chỉ nhận cookie phiên được ký, HttpOnly và SameSite=Strict. Mỗi trình duyệt chỉ đọc được lịch sử thuộc phiên của mình. Dữ liệu nằm trong bảng `emi_lab_conversations`; RLS bật, vai trò `anon` và `authenticated` không có quyền trực tiếp.

Migration: `sql/emi_sales_lab.sql`. Lab lưu toàn bộ snapshot persona/catalog cùng lịch sử, memory và kết quả phân tích của từng lượt. Gửi lại cùng request ID không gọi OpenAI hoặc ghi lịch sử lần hai. Revision và lock trong Postgres ngăn hai lượt đồng thời ghi đè nhau.

## Mở Lab local để evaluation

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

Project gốc dùng Node ESM, OpenAI SDK, Supabase, bốn Vercel API (`webhook`, `products`, `facebook-ads`, `lab`) và giao diện HTML/JS. Workflow dashboard là Next.js riêng. Messenger hiện chạy giới thiệu sản phẩm theo Ads rồi bàn giao nhân viên; chức năng preview hiện tại chạy kịch bản giới thiệu, không phải bộ não sale.

Bản local dùng server Node riêng để chạy evaluation nâng cao. Server chỉ bind `127.0.0.1`, kiểm tra Host/Origin, JSON content-type, body limit, CSP và escape dữ liệu UI.

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

Phần web bổ sung:

| File | Vai trò |
| --- | --- |
| `public/lab/*` | Trang chat test trong shell LeafChat |
| `api/lab.js` | Vercel Function cùng origin |
| `lab/cloud/*` | Phiên ký, service chat và Supabase store |
| `sql/emi_sales_lab.sql` | Bảng Lab, RLS và RPC khóa/commit lượt chat |
| `test/emi-cloud-lab.test.js` | Kiểm thử context, retry, phiên và isolation |

Phần local vẫn dùng SQLite riêng. Phần web dùng bảng Supabase có tiền tố `emi_lab_`; không đọc hoặc ghi bảng Messenger, sản phẩm, đơn hàng hay tồn kho production.

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

Kết quả hiện tại: **124/124 test pass**, gồm cả phiên web được ký, isolation giữa hai trình duyệt, origin protection, retry idempotent và khóa lượt đồng thời. Bộ test không gửi Messenger. Các case đánh giá local vẫn cần chạy riêng với OpenAI thật và người sale chấm; schema hợp lệ không tự chứng nhận chất lượng tư vấn.
