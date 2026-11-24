// Terms of use and privacy policy. Written against Vietnamese personal-data law;
// have them checked by a lawyer before charging money. Bump TERMS_VERSION on
// the server whenever the substance changes: everyone is asked to accept again.
import { DocLayout } from '../layouts';
import { Link } from '../router';
import { useSession } from '../session';

const UPDATED = '26/11/2026';

function useOperator() {
  const { config } = useSession();
  return {
    name: config?.operatorName || 'đơn vị vận hành JobRadar',
    email: config?.contactEmail || '',
  };
}

function Contact() {
  const op = useOperator();
  return op.email
    ? <p>Liên hệ: <a href={`mailto:${op.email}`}>{op.email}</a></p>
    : <p>Liên hệ: qua mục hỗ trợ trong ứng dụng.</p>;
}

export function Privacy() {
  const op = useOperator();
  return (
    <DocLayout>
      <h1>Chính sách quyền riêng tư</h1>
      <p className="updated">Cập nhật: {UPDATED}</p>
      <p>Chính sách này giải thích JobRadar thu thập dữ liệu cá nhân nào của bạn, dùng để làm gì, chia sẻ với ai và bạn có những quyền gì, theo Luật Bảo vệ dữ liệu cá nhân và các văn bản hướng dẫn của Việt Nam.</p>

      <h2>1. Ai xử lý dữ liệu của bạn</h2>
      <p>Bên kiểm soát và xử lý dữ liệu là {op.name}.</p>
      <Contact />

      <h2>2. Dữ liệu chúng tôi thu thập</h2>
      <ul>
        <li><b>Tài khoản:</b> email, tên hiển thị, mật khẩu (chỉ lưu dạng đã băm, không ai đọc được). Nếu bạn đăng nhập bằng Google: email, tên và mã định danh tài khoản Google.</li>
        <li><b>Hồ sơ nghề nghiệp</b> (khi bạn cung cấp): kỹ năng, kinh nghiệm, mức giá mong muốn, câu trả lời bảng hỏi và tệp CV.</li>
        <li><b>Hoạt động trong ứng dụng:</b> job bạn lưu, ẩn, đánh dấu đã nộp; cài đặt thông báo; mã chat Telegram nếu bạn liên kết.</li>
        <li><b>Dữ liệu kỹ thuật:</b> cookie đăng nhập, địa chỉ IP và thời điểm truy cập trong nhật ký máy chủ, dùng để bảo mật.</li>
      </ul>
      <p>Chúng tôi không yêu cầu dữ liệu cá nhân nhạy cảm. Đừng đưa số CCCD, ảnh giấy tờ, thông tin sức khoẻ hay tài khoản ngân hàng vào CV hoặc hồ sơ.</p>

      <h2>3. Mục đích sử dụng</h2>
      <ul>
        <li>Lọc và xếp hạng job phù hợp với hồ sơ của bạn, tóm tắt job, chấm mức phù hợp và soạn nháp hồ sơ ứng tuyển theo yêu cầu của bạn.</li>
        <li>Gửi thông báo job qua Telegram và email liên quan đến tài khoản (xác minh email, đặt lại mật khẩu, có hồ sơ ứng tuyển mới).</li>
        <li>Khi bạn <b>ứng tuyển một tin đăng trên JobRadar</b> và tích ô đồng ý: chia sẻ tên, email, lời nhắn, nội dung hồ sơ và (nếu bạn chọn) CV của bạn với đúng nhà tuyển dụng đăng tin đó. Nhà tuyển dụng tự chịu trách nhiệm về việc dùng các thông tin này để tuyển dụng.</li>
        <li>Bảo mật, chống lạm dụng và hỗ trợ khi bạn liên hệ.</li>
      </ul>
      <p>Chúng tôi không bán dữ liệu của bạn và không dùng dữ liệu của bạn để quảng cáo nhắm theo cá nhân.</p>

      <h2>4. Cơ sở xử lý</h2>
      <p>Chúng tôi xử lý dữ liệu dựa trên sự đồng ý của bạn khi tạo tài khoản. Bạn có thể rút lại sự đồng ý bất cứ lúc nào bằng cách xoá tài khoản; việc rút lại không ảnh hưởng đến các xử lý đã thực hiện trước đó.</p>

      <h2>5. Bên thứ ba và chuyển dữ liệu ra nước ngoài</h2>
      <p>Để vận hành dịch vụ, một phần dữ liệu được xử lý bởi các nhà cung cấp sau, có máy chủ đặt ngoài Việt Nam:</p>
      <ul>
        <li><b>Google</b>: đăng nhập bằng Google; Gemini API xử lý hồ sơ, CV và nội dung job <i>chỉ khi bạn dùng tính năng AI</i>. Chúng tôi dùng Gemini API theo điều khoản dịch vụ trả phí của Google.</li>
        <li><b>Render</b> (máy chủ ứng dụng), <b>Neon</b> (cơ sở dữ liệu), <b>Resend</b> (gửi email), <b>Telegram</b> (gửi thông báo khi bạn liên kết).</li>
      </ul>
      <p>Chúng tôi chỉ chuyển phần dữ liệu cần thiết cho từng mục đích và thực hiện các nghĩa vụ về chuyển dữ liệu ra nước ngoài theo quy định của pháp luật Việt Nam.</p>

      <h2>6. Thời gian lưu trữ</h2>
      <p>Dữ liệu được lưu khi tài khoản còn hoạt động. Khi bạn xoá tài khoản, dữ liệu bị xoá ngay khỏi cơ sở dữ liệu đang chạy và khỏi các bản sao lưu trong vòng 30 ngày. Nhật ký máy chủ được giữ tối đa 30 ngày.</p>

      <h2>7. Quyền của bạn</h2>
      <ul>
        <li>Được biết về việc xử lý dữ liệu và đồng ý hoặc rút lại sự đồng ý.</li>
        <li>Truy cập và nhận bản sao dữ liệu: dùng nút <b>Tải dữ liệu</b> trong mục <Link to="/account">Tài khoản</Link>.</li>
        <li>Chỉnh sửa dữ liệu: sửa trực tiếp trong ứng dụng.</li>
        <li>Xoá dữ liệu: dùng nút <b>Xoá tài khoản</b>.</li>
        <li>Yêu cầu hạn chế hoặc phản đối việc xử lý, và khiếu nại đến cơ quan nhà nước có thẩm quyền về bảo vệ dữ liệu cá nhân.</li>
      </ul>
      <p>Với các yêu cầu không làm được trực tiếp trong ứng dụng, hãy liên hệ với chúng tôi; chúng tôi phản hồi trong thời hạn pháp luật quy định.</p>

      <h2>8. Bảo mật</h2>
      <p>Kết nối được mã hoá (HTTPS), mật khẩu được băm bằng thuật toán scrypt, phiên đăng nhập có thể bị thu hồi. Nếu xảy ra sự cố lộ lọt dữ liệu, chúng tôi sẽ thông báo cho bạn và cơ quan có thẩm quyền theo quy định.</p>

      <h2>9. Cookie và quảng cáo</h2>
      <p>Chúng tôi dùng cookie cần thiết để giữ trạng thái đăng nhập. Gói Free, trang chủ và blog có thể hiển thị quảng cáo của <b>Google AdSense</b> để giữ dịch vụ miễn phí. Quảng cáo của Google <b>chỉ được tải sau khi bạn bấm "Đồng ý"</b> trên thông báo quảng cáo; khi đó Google có thể dùng cookie và địa chỉ IP để chọn và đo lường quảng cáo, theo chính sách của Google. Nếu bạn bấm "Không", chỉ có thông tin giới thiệu của JobRadar ở các vị trí đó. Lựa chọn được lưu trong trình duyệt của bạn; xoá dữ liệu trang web để chọn lại. Gói Pro không có quảng cáo. Chúng tôi không chia sẻ hồ sơ, CV hay danh sách job của bạn cho bên quảng cáo.</p>

      <h2>10. Độ tuổi</h2>
      <p>JobRadar dành cho người từ đủ 18 tuổi.</p>

      <h2>11. Thay đổi chính sách</h2>
      <p>Khi nội dung chính sách thay đổi, chúng tôi sẽ thông báo trong ứng dụng và đề nghị bạn đồng ý lại trước khi tiếp tục sử dụng.</p>
    </DocLayout>
  );
}

export function Terms() {
  const op = useOperator();
  return (
    <DocLayout>
      <h1>Điều khoản sử dụng</h1>
      <p className="updated">Cập nhật: {UPDATED}</p>
      <p>Khi tạo tài khoản và sử dụng JobRadar, bạn đồng ý với các điều khoản dưới đây. Dịch vụ do {op.name} vận hành.</p>

      <h2>1. Dịch vụ</h2>
      <p>JobRadar tổng hợp tin tuyển dụng remote và freelance từ các nguồn công khai. Mỗi tin dẫn về trang gốc, nơi bạn tự ứng tuyển. JobRadar không phải nhà tuyển dụng và không bảo đảm tin còn hiệu lực, chính xác hay đáng tin cậy.</p>

      <h2>2. Tài khoản</h2>
      <p>Bạn phải từ đủ 18 tuổi, cung cấp thông tin đúng và tự bảo vệ mật khẩu của mình. Mỗi người chỉ dùng một tài khoản.</p>

      <h2>3. AI soạn, bạn quyết định</h2>
      <p>Các tính năng AI (tóm tắt, chấm mức phù hợp, soạn proposal và câu trả lời) chỉ tạo bản nháp và có thể sai. Bạn có trách nhiệm đọc lại và chỉnh sửa trước khi dùng. JobRadar không bao giờ tự nộp đơn, gửi tin nhắn hay liên hệ nhà tuyển dụng thay bạn.</p>

      <h2>4. Điều khoản của các trang tuyển dụng</h2>
      <p>Bạn tự tuân thủ điều khoản của các trang nơi bạn ứng tuyển (ví dụ Freelancer.com, Upwork). Không dùng JobRadar để vi phạm các điều khoản đó, chẳng hạn gửi đơn hàng loạt tự động.</p>

      <h2>5. Cảnh giác lừa đảo</h2>
      <p>Cảnh báo lừa đảo của JobRadar chỉ mang tính tham khảo. Không chuyển tiền, đặt cọc hay cung cấp giấy tờ tuỳ thân cho bên tuyển dụng chưa xác minh. Hãy báo cáo tin đáng ngờ để chúng tôi kiểm tra.</p>

      <h2>6. Gói dịch vụ</h2>
      <p>Tài khoản mới được dùng thử miễn phí mọi tính năng trong 7 ngày. Sau đó bạn có thể dùng gói Miễn phí hoặc gói Pro (79.000đ/tháng). Cách thanh toán sẽ được công bố trong ứng dụng. Nếu giá thay đổi, chúng tôi thông báo trước khi áp dụng.</p>

      <h2>7. Hành vi bị cấm</h2>
      <ul>
        <li>Thu thập dữ liệu tự động từ JobRadar, hoặc dùng tính năng AI để tạo nội dung vi phạm pháp luật.</li>
        <li>Tạo nhiều tài khoản để lách giới hạn, chia sẻ tài khoản trả phí, hoặc tấn công, làm gián đoạn dịch vụ.</li>
      </ul>

      <h2>7a. Nhà tuyển dụng đăng tin trên JobRadar</h2>
      <ul>
        <li>Tin phải là việc làm có thật, mô tả trung thực; JobRadar duyệt trước khi hiển thị và có thể từ chối, đóng hoặc gỡ tin bất kỳ lúc nào.</li>
        <li><b>Nghiêm cấm thu bất kỳ khoản phí nào của ứng viên</b> (phí hồ sơ, đặt cọc, mua khoá học, mua thiết bị…), yêu cầu giấy tờ tuỳ thân trước khi tuyển, hoặc tuyển cho việc vi phạm pháp luật.</li>
        <li>Thông tin ứng viên nhận được chỉ được dùng để tuyển dụng cho tin đó, không chia sẻ cho bên khác, và phải được xoá khi không còn cần.</li>
        <li>JobRadar không phải bên tuyển dụng hay trung gian thanh toán, không bảo đảm kết quả tuyển dụng.</li>
      </ul>

      <h2>8. Quyền sở hữu</h2>
      <p>Nội dung tin tuyển dụng thuộc về bên đăng tin và trang nguồn. Hồ sơ, CV và nội dung bạn tạo thuộc về bạn.</p>

      <h2>9. Giới hạn trách nhiệm</h2>
      <p>Dịch vụ được cung cấp theo hiện trạng. Trong phạm vi pháp luật cho phép, JobRadar không chịu trách nhiệm về kết quả ứng tuyển, về giao dịch giữa bạn và bên tuyển dụng, hay về thiệt hại phát sinh từ nội dung của bên thứ ba.</p>

      <h2>10. Chấm dứt</h2>
      <p>Bạn có thể xoá tài khoản bất cứ lúc nào trong mục Tài khoản. Chúng tôi có thể tạm khoá hoặc chấm dứt tài khoản vi phạm điều khoản này.</p>

      <h2>11. Luật áp dụng</h2>
      <p>Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Xem thêm <Link to="/privacy">Chính sách quyền riêng tư</Link>.</p>
      <Contact />
    </DocLayout>
  );
}
