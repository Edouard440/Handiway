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

type OrsStep = {
  instruction?: string;
  distance?: number;
  duration?: number;
  way_points?: [number, number];
};

type OrsFeature = {
  geometry?: {
    coordinates?: [number, number][];
  };
  properties?: {
    summary?: {
      distance?: number;
      duration?: number;
    };
    segments?: {
      steps?: OrsStep[];
    }[];
  };
};

type RouteResult = {
  coords: [number, number][];
  distance: number;
  duration: number;
  steps: {
    instruction: string;
    distance: number;
    duration: number;
    location: [number, number];
  }[];
};

type OrsRouteResult =
  | { route: RouteResult; fallbackReason: null; orsProfile: string }
  | { route: null; fallbackReason: string };

type AvoidPoint = {
  lat: number;
  lng: number;
};

const AVOID_RADIUS_METERS = 80;
const ORS_AVOID_RADII_METERS = [70, 45, 25, 12];
const DETOUR_DISTANCES_METERS = [90, 150, 240, 360];
const DETOUR_APPROACH_DISTANCES_METERS = [120, 220];
const MAX_DETOUR_RATIO = 2.15;
const MAX_DETOUR_EXTRA_METERS = 2200;
const MAX_AVOID_POINTS = 8;

function parseCoordinate(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAvoidPoints(value: string | null): AvoidPoint[] {
  if (!value) return [];

  return value
    .split("|")
    .map((item) => {
      const [latRaw, lngRaw] = item.split(",");
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    })
    .filter((item): item is AvoidPoint => item !== null)
    .slice(0, MAX_AVOID_POINTS);
}

function circlePolygon(point: AvoidPoint, radiusMeters: number, vertices = 12) {
  const coordinates = Array.from({ length: vertices }, (_, index) => {
    const angle = (index / vertices) * Math.PI * 2;
    const northMeters = Math.sin(angle) * radiusMeters;
    const eastMeters = Math.cos(angle) * radiusMeters;
    const nextPoint = offsetCoordinate(point, northMeters, eastMeters);
    return [nextPoint.lng, nextPoint.lat];
  });

  coordinates.push(coordinates[0]);
  return [coordinates];
}

function avoidPolygons(points: AvoidPoint[], origin: AvoidPoint, destination: AvoidPoint, radiusMeters: number) {
  const polygons = points
    .filter(
      (point) =>
        metersBetween([point.lat, point.lng], [origin.lat, origin.lng]) > radiusMeters * 2 &&
        metersBetween([point.lat, point.lng], [destination.lat, destination.lng]) > radiusMeters * 2
    )
    .map((point) => circlePolygon(point, radiusMeters));

  if (polygons.length === 0) return null;

  return {
    type: "MultiPolygon",
    coordinates: polygons,
  };
}

function metersBetween([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) {
  const radius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return radius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function distanceToSegmentMeters(point: AvoidPoint, start: [number, number], end: [number, number]) {
  const latScale = 111320;
  const lngScale = 111320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.2);
  const px = point.lng * lngScale;
  const py = point.lat * latScale;
  const ax = start[1] * lngScale;
  const ay = start[0] * latScale;
  const bx = end[1] * lngScale;
  const by = end[0] * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function countObstacleHits(coords: [number, number][], avoidPoints: AvoidPoint[]) {
  return avoidPoints.filter((point) => {
    for (let index = 1; index < coords.length; index += 1) {
      if (distanceToSegmentMeters(point, coords[index - 1], coords[index]) < AVOID_RADIUS_METERS) {
        return true;
      }
    }

    return coords.some((coord) => metersBetween(coord, [point.lat, point.lng]) < AVOID_RADIUS_METERS);
  }).length;
}

function offsetCoordinate(point: AvoidPoint, northMeters: number, eastMeters: number): AvoidPoint {
  return {
    lat: point.lat + northMeters / 111320,
    lng: point.lng + eastMeters / (111320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.2)),
  };
}

function centroid(points: AvoidPoint[]) {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function routeVector(origin: AvoidPoint, destination: AvoidPoint, at: AvoidPoint) {
  const north = destination.lat - origin.lat;
  const east = (destination.lng - origin.lng) * Math.cos((at.lat * Math.PI) / 180);
  const length = Math.hypot(north, east) || 1;

  return {
    along: { north: north / length, east: east / length },
    perpendiculars: [
      { north: -east / length, east: north / length },
      { north: east / length, east: -north / length },
    ],
  };
}

function detourCandidates(origin: AvoidPoint, destination: AvoidPoint, blockingPoints: AvoidPoint[]) {
  const centers = [centroid(blockingPoints), ...blockingPoints].slice(0, 4);

  const candidates = centers.flatMap((center) =>
    DETOUR_DISTANCES_METERS.flatMap((distance) => {
      const { along, perpendiculars } = routeVector(origin, destination, center);

      return DETOUR_APPROACH_DISTANCES_METERS.flatMap((approachDistance) =>
        perpendiculars.map((direction) => [
          offsetCoordinate(
            center,
            direction.north * distance - along.north * approachDistance,
            direction.east * distance - along.east * approachDistance
          ),
          offsetCoordinate(
            center,
            direction.north * distance + along.north * approachDistance,
            direction.east * distance + along.east * approachDistance
          ),
        ])
      );
    })
  );
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = candidate.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(";");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isReasonableDetour(candidate: RouteResult, directRoute: RouteResult) {
  const maxDistance = Math.max(
    directRoute.distance * MAX_DETOUR_RATIO,
    directRoute.distance + MAX_DETOUR_EXTRA_METERS
  );

  return candidate.distance <= maxDistance;
}

function routeScore(route: RouteResult, hits: number, directRoute: RouteResult) {
  const distancePenalty = Math.max(0, route.distance - directRoute.distance) * 1.35;
  const durationPenalty = Math.max(0, route.duration - directRoute.duration) * 0.45;
  return hits * 50000 + distancePenalty + durationPenalty;
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

async function fetchOsrmRoute(profile: "foot" | "driving", points: AvoidPoint[]): Promise<RouteResult | null> {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`https://router.project-osrm.org/route/v1/${profile}/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as { routes?: OsrmRoute[] };
  const route = data.routes?.[0];
  const routeCoordinates = route?.geometry?.coordinates;

  if (!route || !Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return null;
  }

  const origin = points[0];

  return {
    coords: routeCoordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance ?? 0,
    duration: route.duration ?? 0,
    steps:
      route.legs?.flatMap((leg) =>
        leg.steps?.map((step) => {
          const location = step.maneuver?.location ?? [origin.lng, origin.lat];
          return {
            instruction: step.maneuver?.instruction ?? fallbackInstruction(step),
            distance: step.distance ?? 0,
            duration: step.duration ?? 0,
            location: [location[1], location[0]] as [number, number],
          };
        }) ?? []
      ) ?? [],
  };
}

async function fetchOpenRouteServiceRoute(
  profile: "foot" | "driving",
  origin: AvoidPoint,
  destination: AvoidPoint,
  avoidPoints: AvoidPoint[]
): Promise<OrsRouteResult> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) {
    return { route: null, fallbackReason: "Clé OPENROUTESERVICE_API_KEY manquante" };
  }

  const orsProfiles = profile === "driving" ? ["driving-car"] : ["wheelchair", "foot-walking"];
  const optionModes = ["full", "polygons-only", "features-only", "none"] as const;
  const errors: string[] = [];
  let bestRoute: RouteResult | null = null;
  let bestProfile = "";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const orsProfile of orsProfiles) {
    for (const optionMode of optionModes) {
      const radii = optionMode === "features-only" || optionMode === "none" ? [0] : ORS_AVOID_RADII_METERS;

      for (const radius of radii) {
      const polygons = avoidPolygons(avoidPoints, origin, destination, radius);
      const shouldUsePolygons = (optionMode === "full" || optionMode === "polygons-only") && polygons;
      const shouldAvoidFeatures =
        profile !== "driving" && (optionMode === "full" || optionMode === "features-only");
      const body: Record<string, unknown> = {
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        elevation: false,
        geometry: true,
        instructions: true,
        language: "fr",
        units: "m",
      };

      const options: Record<string, unknown> = {};
      if (shouldUsePolygons) {
        options.avoid_polygons = polygons;
      }
      if (shouldAvoidFeatures) {
        options.avoid_features = ["steps"];
      }
      if (Object.keys(options).length > 0) {
        body.options = options;
      }

      const response = await fetch(`https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`, {
        method: "POST",
        headers: {
          Accept: "application/json, application/geo+json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (!response.ok) {
        let details = "";
        try {
          const errorData = (await response.json()) as { error?: { message?: string }; message?: string };
          details = errorData.error?.message ?? errorData.message ?? "";
        } catch {
          details = "";
        }
        errors.push(
          `${orsProfile}/${optionMode}${radius ? `/${radius}m` : ""} (${response.status})${
            details ? ` : ${details}` : ""
          }`
        );
        continue;
      }

      const data = (await response.json()) as { features?: OrsFeature[] };
      const feature = data.features?.[0];
      const coordinates = feature?.geometry?.coordinates;

      if (!feature || !Array.isArray(coordinates) || coordinates.length === 0) {
        errors.push(`${orsProfile}/${optionMode}${radius ? `/${radius}m` : ""} : aucun itinéraire`);
        continue;
      }

      const coords = coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      const route = {
        coords,
        distance: feature.properties?.summary?.distance ?? 0,
        duration: feature.properties?.summary?.duration ?? 0,
        steps:
          feature.properties?.segments?.flatMap((segment) =>
            segment.steps?.map((step) => {
              const index = step.way_points?.[0] ?? 0;
              return {
                instruction: step.instruction ?? "Continuez",
                distance: step.distance ?? 0,
                duration: step.duration ?? 0,
                location: coords[index] ?? coords[0] ?? [origin.lat, origin.lng],
              };
            }) ?? []
          ) ?? [],
      };
      const remainingObstacles = countObstacleHits(route.coords, avoidPoints);
      const profilePenalty = orsProfile === "wheelchair" ? 0 : 180;
      const optionPenalty =
        optionMode === "full" ? 0 : optionMode === "polygons-only" ? 70 : optionMode === "features-only" ? 120 : 220;
      const candidateScore = remainingObstacles * 80000 + route.distance * 1.2 + route.duration * 0.35 + profilePenalty + optionPenalty;

      if (candidateScore < bestScore) {
        bestRoute = route;
        bestProfile = `${orsProfile}/${optionMode}${radius ? `/${radius}m` : ""}`;
        bestScore = candidateScore;
      }
      }
    }
  }

  if (bestRoute) {
    return {
      route: bestRoute,
      fallbackReason: null,
      orsProfile: bestProfile,
    };
  }

  return {
    route: null,
    fallbackReason: `OpenRouteService n'a trouvé aucun itinéraire (${errors[0] ?? "raison inconnue"})`,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromLat = parseCoordinate(searchParams.get("fromLat"));
  const fromLng = parseCoordinate(searchParams.get("fromLng"));
  const toLat = parseCoordinate(searchParams.get("toLat"));
  const toLng = parseCoordinate(searchParams.get("toLng"));
  const profile = searchParams.get("profile") === "driving" ? "driving" : "foot";
  const avoidPoints = parseAvoidPoints(searchParams.get("avoid"));

  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    return NextResponse.json({ error: "Missing or invalid coordinates" }, { status: 400 });
  }

  try {
    const origin = { lat: fromLat, lng: fromLng };
    const destination = { lat: toLat, lng: toLng };
    const orsResult = await fetchOpenRouteServiceRoute(profile, origin, destination, avoidPoints);
    const orsRoute = orsResult.route;

    if (orsRoute) {
      const remainingObstacles = countObstacleHits(orsRoute.coords, avoidPoints);

      return NextResponse.json({
        ...orsRoute,
        adapted: avoidPoints.length > 0 && remainingObstacles === 0,
        avoidedObstacles: Math.max(0, avoidPoints.length - remainingObstacles),
        remainingObstacles,
        provider: "openrouteservice",
        providerProfile: orsResult.orsProfile,
      });
    }

    const directRoute = await fetchOsrmRoute(profile, [origin, destination]);

    if (!directRoute) {
      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const directHits = countObstacleHits(directRoute.coords, avoidPoints);
    let bestRoute = directRoute;
    let bestHits = directHits;

    if (directHits > 0) {
      const blockingPoints = avoidPoints
        .filter((point) =>
          directRoute.coords.some((coord) => metersBetween(coord, [point.lat, point.lng]) < AVOID_RADIUS_METERS)
        )
        .slice(0, 3);

      for (const detourPoints of detourCandidates(origin, destination, blockingPoints)) {
        const candidate = await fetchOsrmRoute(profile, [origin, ...detourPoints, destination]);
        if (!candidate) continue;
        if (!isReasonableDetour(candidate, directRoute)) continue;

        const candidateHits = countObstacleHits(candidate.coords, avoidPoints);
        const currentScore = routeScore(bestRoute, bestHits, directRoute);
        const candidateScore = routeScore(candidate, candidateHits, directRoute);

        if (candidateScore < currentScore) {
          bestRoute = candidate;
          bestHits = candidateHits;
        }
      }
    }

    return NextResponse.json({
      ...bestRoute,
      adapted: directHits > bestHits,
      avoidedObstacles: Math.max(0, directHits - bestHits),
      remainingObstacles: bestHits,
      provider: "osrm-fallback",
      providerReason: orsResult.fallbackReason,
    });
  } catch {
    return NextResponse.json({ error: "Route request failed" }, { status: 502 });
  }
}
