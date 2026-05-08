# 학급 그룹 사진첩

Next.js App Router, TypeScript, Tailwind CSS, Supabase로 만든 학급 그룹별 사진첩입니다.

## 환경 변수

`.env.local`에 아래 값을 설정합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
NEXT_PUBLIC_SITE_URL=
SERVER_ACTION_ALLOWED_ORIGINS=
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 코드에서만 사용합니다.
`NEXT_PUBLIC_SITE_URL`에는 실제 접속 도메인 전체 URL을 넣습니다. 예: `https://album.example.com`
프록시나 터널 환경에서 여러 도메인이 필요하면 `SERVER_ACTION_ALLOWED_ORIGINS`에 쉼표로 구분해 host를 추가합니다. 예: `album.example.com,*.ngrok-free.app`
개발 모드에서는 `localhost:3000`, GitHub Codespaces preview, ngrok 도메인을 기본 허용합니다. 설정 변경 후에는 Next dev 서버를 재시작해야 합니다.

## Supabase 설정

1. 새 Supabase 프로젝트라면 SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. 이미 `classes`, `groups`, `students` 같은 테이블이 있는 프로젝트라면 `supabase/repair-existing-schema.sql`을 실행합니다.
3. Storage bucket `group-photos`가 private bucket으로 생성됩니다.
4. 앱은 서버에서 signed URL을 발급해 사진을 표시합니다.

## 실행

```bash
npm run dev
```

관리자 페이지는 `/admin`입니다.
