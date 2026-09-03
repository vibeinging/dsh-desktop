/** Fetch an authenticated official Web page without relying on a process-wide cookie jar. */
export async function fetchOfficialWebHtml(surface) {
  const initial = await fetch(surface, { redirect: "manual" });
  let response = initial;
  if (initial.status >= 300 && initial.status < 400) {
    const location = initial.headers.get("location");
    const setCookie = initial.headers.getSetCookie?.()[0] || initial.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";", 1)[0];
    if (!location || !cookie) {
      throw new Error(`official Web token exchange did not return location and cookie (HTTP ${initial.status})`);
    }
    response = await fetch(new URL(location, surface), {
      redirect: "manual",
      headers: { cookie },
    });
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`official Web page failed (HTTP ${response.status}): ${body.slice(0, 240)}`);
  }
  return body;
}
