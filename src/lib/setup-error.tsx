export function isMissingSchemaError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

export function SetupError() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-zinc-950">
      <section className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Supabase 스키마 확인 필요</p>
        <h1 className="mt-2 text-2xl font-bold">DB 컬럼이 앱 스키마와 다릅니다</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Supabase SQL Editor에서 <code className="font-mono">supabase/schema.sql</code>을 실행한 뒤
          페이지를 새로고침하세요. 기존 테이블에 <code className="font-mono">class_id</code>가 있는 경우
          SQL이 <code className="font-mono">class_no</code> 컬럼을 추가하고 값을 복사합니다.
        </p>
      </section>
    </main>
  );
}
