export default async (req) => {
  const url = new URL(req.url);
  const target = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary");
  target.search = url.search;

  const resp = await fetch(target.toString(), {
    headers: { "Accept": "application/json" },
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
};

export const config = {
  path: "/api/espn/summary",
};
