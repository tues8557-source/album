# 학급 그룹 사진첩

Next.js App Router, TypeScript, Tailwind CSS, Supabase로 만든 학급 그룹별 사진첩입니다.

## 환경 변수

`.env.local`에 아래 값을 설정합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=
ADMIN_PASSWORD=
NEXT_PUBLIC_SITE_URL=
SERVER_ACTION_ALLOWED_ORIGINS=
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 코드에서만 사용합니다.
`SESSION_SECRET`에는 충분히 긴 랜덤 문자열을 넣어야 합니다. 관리자 쿠키와 그룹 접근 쿠키 서명에 사용됩니다.
없으면 기존 `ADMIN_PASSWORD` 또는 `SUPABASE_SERVICE_ROLE_KEY`로 임시 fallback하지만, 운영 환경에서는 반드시 별도로 설정하는 편이 맞습니다.
`NEXT_PUBLIC_SITE_URL`에는 실제 접속 도메인 전체 URL을 넣습니다. 예: `https://album.example.com`
프록시나 터널 환경에서 여러 도메인이 필요하면 `SERVER_ACTION_ALLOWED_ORIGINS`에 쉼표로 구분해 host를 추가합니다. 예: `album.example.com,*.ngrok-free.app`
개발 모드에서는 `localhost:3000`, GitHub Codespaces preview, ngrok 도메인을 기본 허용합니다. 설정 변경 후에는 Next dev 서버를 재시작해야 합니다.

## 보안 메모

그룹 비밀번호는 단방향 해시로 저장되므로, 저장 후에는 관리자 페이지에서도 원문을 다시 확인하거나 복사할 수 없습니다. 필요하면 새 비밀번호로 다시 설정해야 합니다.

그룹 접근 권한은 URL 쿼리스트링이 아니라 `HttpOnly` 쿠키로 유지됩니다. 예전 북마크 주소로는 다시 비밀번호 입력이 필요할 수 있습니다.

## Supabase 설정

1. 새 Supabase 프로젝트라면 SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. 이미 `groups`, `students`, `photos` 같은 테이블이 있는 프로젝트라면 `supabase/repair-existing-schema.sql`을 실행합니다.
3. Storage bucket `group-photos`가 private bucket으로 생성됩니다.
4. 앱은 서버에서 signed URL을 발급해 사진을 표시합니다.

## 실행

```bash
npm run dev
```

관리자 페이지는 `/admin`입니다.
