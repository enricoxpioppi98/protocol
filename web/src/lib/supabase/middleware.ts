import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — this is required for Server Components to read
  // an up-to-date session. Do NOT replace with getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from the app
  const isAppRoute = request.nextUrl.pathname.startsWith('/diary') ||
    request.nextUrl.pathname.startsWith('/recipes') ||
    request.nextUrl.pathname.startsWith('/progress') ||
    request.nextUrl.pathname.startsWith('/settings') ||
    request.nextUrl.pathname.startsWith('/food-search');

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup');

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/diary';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
