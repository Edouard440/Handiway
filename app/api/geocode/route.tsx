import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  // Nominatim OpenStreetMap (geocoding)
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      // Important: Nominatim demande un User-Agent identifiable.
      // Depuis un serveur Next, on peut le mettre.
      "User-Agent": "HandiWay/1.0 (school project)",
      "Accept-Language": "fr",
    },
    // petite protection anti-cache
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Geocode failed" }, { status: 500 });
  }

  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  const first = data[0];
  return NextResponse.json(
    {
      found: true,
      lat: Number(first.lat),
      lon: Number(first.lon),
      display_name: first.display_name,
    },
    { status: 200 }
  );
}