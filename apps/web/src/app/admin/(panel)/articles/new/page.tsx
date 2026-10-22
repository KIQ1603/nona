import { NewArticleForm } from '@/features/admin/new-article-form';

export default function NewArticlePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Viết bài mới</h1>
          <p>Nhập tiêu đề trước; ảnh bìa và nội dung chi tiết thêm ở bước tiếp theo.</p>
        </div>
      </div>
      <NewArticleForm />
    </>
  );
}
