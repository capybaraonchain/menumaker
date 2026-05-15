export const dynamic = 'force-static'

export function GET(request: Request) {
  return Response.redirect(new URL('/icon.svg', request.url), 307)
}
