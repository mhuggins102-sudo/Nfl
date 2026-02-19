export default async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) {
    return new Response(JSON.stringify({ error: "Missing q parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Fetch YouTube search results page
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`;
    const resp = await fetch(ytUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "YouTube fetch failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const html = await resp.text();

    // Extract first video ID from YouTube's initial data JSON
    // YouTube embeds video data in a ytInitialData JSON blob
    const patterns = [
      /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
      /\/watch\?v=([a-zA-Z0-9_-]{11})/,
    ];

    let videoId = null;
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        videoId = m[1];
        break;
      }
    }

    if (!videoId) {
      return new Response(JSON.stringify({ error: "No video found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ videoId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/youtube",
};
