import { NextResponse } from "next/server";

type OsrmStep = {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: {
    instruction?: string;
    location?: [number, number];
    type?: string;
    modifier?: string;
  };
};

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: {
    coordinates?: [number, number][];
  };
  legs?: {
    steps?: OsrmStep[];
  }[];
};

function parseCoordinate(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fallbackInstruction(step: OsrmStep) {
  const modifier = step.maneuver?.modifier;
  const road = step.name ? ` sur ${step.name}` : "";

  switch (step.maneuver?.type) {
    case "depart":
      return `Départ${road}`;
    case "arrive":
      return "Vous êtes arrivé";
    case "turn":
      return `${modifier === "left" ? "Tournez à gauche" : modifier === "right" ? "Tournez à droite" : "Tournez"}${road}`;
    case "new name":
      return `Continuez${road}`;
    case "roundabout":
      return `Entrez dans le rond-point${road}`;
    default:
      return `Continuez${road}`;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromLat = parseCoordinate(searchParams.get("fromLat"));
  const fromLng = parseCoordinate(searchParams.get("fromLng"));
  const toLat = parseCoordinate(searchParams.get("toLat"));
  const toLng = parseCoordinate(searchParams.get("toLng"));
  const profile = searchParams.get("profile") === "driving" ? "driving" : "foot";

  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    return NextResponse.json({ error: "Missing or invalid coordinates" }, { status: 400 });
  }

  const url = new URL(
    `https://router.project-osrm.org/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}`
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      return NextResponse.json({ error: "Route service failed" }, { status: 502 });
    }

    const data = (await response.json()) as { routes?: OsrmRoute[] };
    const route = data.routes?.[0];
    const coordinates = route?.geometry?.coordinates;

    if (!route || !Array.isArray(coordinates) || coordinates.length === 0) {
      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    return NextResponse.json({
      coords: coordinates.map(([lng, lat]) => [lat, lng]),
      distance: route.distance ?? 0,
      duration: route.duration ?? 0,
      steps:
        route.legs?.[0]?.steps?.map((step) => {
          const location = step.maneuver?.location ?? [fromLng, fromLat];
          return {
            instruction: step.maneuver?.instruction ?? fallbackInstruction(step),
            distance: step.distance ?? 0,
            duration: step.duration ?? 0,
            location: [location[1], location[0]],
          };
        }) ?? [],
    });
  } catch {
    return NextResponse.json({ error: "Route request failed" }, { status: 502 });
  }
}
