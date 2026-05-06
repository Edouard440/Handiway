"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import type { MobilityAid } from "@/app/page";

type MapComponentProps = {
  selectedAid: MobilityAid | null;
  onBackToSelection: () => void;
};

type SidebarTab = "destination" | "departure" | "recents" | "favorites" | "mode";

type SavedAddress = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

type RouteRecord = {
  id: string;
  title: string;
  originLabel: string;
  destinationLabel: string;
  distance: number;
  duration: number;
  createdAt: string;
  origin: [number, number];
  destination: [number, number];
};

type ObstacleType =
  | "Escaliers"
  | "Ascenseur en panne"
  | "Trottoir dégradé"
  | "Pente trop forte"
  | "Passage trop étroit"
  | "Autre";

type Obstacle = {
  id: string;
  type: ObstacleType;
  description: string;
  lat: number;
  lng: number;
  createdAt: string;
};

type RouteStep = {
  instruction: string;
  distance: number;
  duration: number;
  location: [number, number];
};

type RouteState = {
  coords: [number, number][];
  distance: number;
  duration: number;
  steps: RouteStep[];
};

type DraftObstacle = {
  lat: number;
  lng: number;
  type: ObstacleType;
  description: string;
};

const STORAGE_KEY = "handiway_obstacles_v1";
const DEFAULT_CENTER: [number, number] = [48.8566, 2.3522];

const obstacleTypes: ObstacleType[] = [
  "Escaliers",
  "Ascenseur en panne",
  "Trottoir dégradé",
  "Pente trop forte",
  "Passage trop étroit",
  "Autre",
];

const aidLabels: Record<MobilityAid, string> = {
  wheelchair: "Fauteuil roulant",
  scooter: "Scooter électrique",
  walker: "Déambulateur",
  cane: "Canne",
  crutches: "Béquilles",
  prosthetic: "Prothèse",
};

const destinationIcon = L.divIcon({
  className: "destination-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const userIcon = L.divIcon({
  className: "user-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const obstacleIcon = L.divIcon({
  className: "obstacle-marker",
  html: '<span aria-hidden="true">!</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function loadObstacles(): Obstacle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Obstacle>[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is Obstacle =>
        typeof item.id === "string" &&
        typeof item.type === "string" &&
        typeof item.description === "string" &&
        typeof item.lat === "number" &&
        typeof item.lng === "number" &&
        typeof item.createdAt === "string"
    );
  } catch {
    return [];
  }
}

function saveObstacles(obstacles: Obstacle[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obstacles));
}

const SAVED_ADDRESSES_KEY = "handiway_saved_addresses_v1";
const FAVORITE_ROUTES_KEY = "handiway_favorite_routes_v1";
const RECENT_ROUTES_KEY = "handiway_recent_routes_v1";

function loadSavedAddresses(): SavedAddress[] {
  try {
    const raw = localStorage.getItem(SAVED_ADDRESSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSavedAddresses(addresses: SavedAddress[]) {
  localStorage.setItem(SAVED_ADDRESSES_KEY, JSON.stringify(addresses));
}

function loadFavoriteRoutes(): RouteRecord[] {
  try {
    const raw = localStorage.getItem(FAVORITE_ROUTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavoriteRoutes(routes: RouteRecord[]) {
  localStorage.setItem(FAVORITE_ROUTES_KEY, JSON.stringify(routes));
}

function loadRecentRoutes(): RouteRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_ROUTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentRoutes(routes: RouteRecord[]) {
  localStorage.setItem(RECENT_ROUTES_KEY, JSON.stringify(routes));
}

function ClickToAddObstacle({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (enabled) onPick(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
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

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function profileForAid(aid: MobilityAid | null) {
  if (aid === "scooter") return "driving";
  return "foot";
}

function isRouteState(value: RouteState | { error?: string }): value is RouteState {
  return (
    "coords" in value &&
    Array.isArray(value.coords) &&
    typeof value.distance === "number" &&
    typeof value.duration === "number" &&
    Array.isArray(value.steps)
  );
}

export default function MapComponent({ selectedAid, onBackToSelection }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>(() => loadObstacles());
  const [draft, setDraft] = useState<DraftObstacle | null>(null);
  const [reportMode, setReportMode] = useState(false);
  const [route, setRoute] = useState<RouteState | null>(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [destination, setDestination] = useState<{ lat: number; lng: number; label: string } | null>(
    null
  );
  const [addressInput, setAddressInput] = useState("");
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "notfound" | "error">("idle");
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "error">("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("destination");
  const [departureMode, setDepartureMode] = useState<"address" | "saved" | "current">("current");
  const [departureAddressInput, setDepartureAddressInput] = useState("");
  const [departureLocation, setDepartureLocation] = useState<{ label: string; coords: [number, number] } | null>(
    null
  );
  const [departureStatus, setDepartureStatus] = useState<"idle" | "loading" | "notfound" | "error">("idle");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>(() => loadSavedAddresses());
  const [savedAddressId, setSavedAddressId] = useState<string | null>(null);
  const [favoriteRoutes, setFavoriteRoutes] = useState<RouteRecord[]>(() => loadFavoriteRoutes());
  const [recentRoutes, setRecentRoutes] = useState<RouteRecord[]>(() => loadRecentRoutes());

  const center = position ?? DEFAULT_CENTER;
  const selectedAidLabel = selectedAid ? aidLabels[selectedAid] : "non défini";
  const nextStep = route?.steps[currentStepIndex];

  const nearbyObstacles = useMemo(() => {
    if (!route) return [];
    return obstacles.filter((obstacle) =>
      route.coords.some((coord) => metersBetween(coord, [obstacle.lat, obstacle.lng]) < 45)
    );
  }, [obstacles, route]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPosition(DEFAULT_CENTER);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition([pos.coords.latitude, pos.coords.longitude]),
      () => setPosition(DEFAULT_CENTER),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    if (!navigationActive || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const nextPosition: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setPosition(nextPosition);
        mapRef.current?.panTo(nextPosition, { animate: true });

        if (!route) return;

        const step = route.steps[currentStepIndex];
        if (step && metersBetween(nextPosition, step.location) < 20) {
          setCurrentStepIndex((index) => Math.min(index + 1, route.steps.length - 1));
        }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [currentStepIndex, navigationActive, route]);

  function openDraft(lat: number, lng: number) {
    setDraft({ lat, lng, type: "Trottoir dégradé", description: "" });
  }

  function cancelDraft() {
    setDraft(null);
    setReportMode(false);
  }

  function submitDraft() {
    if (!draft) return;

    const obstacle: Obstacle = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      type: draft.type,
      description: draft.description.trim(),
      lat: draft.lat,
      lng: draft.lng,
      createdAt: new Date().toISOString(),
    };

    const next = [obstacle, ...obstacles];
    setObstacles(next);
    saveObstacles(next);
    setDraft(null);
    setReportMode(false);
  }

  function removeObstacle(id: string) {
    const next = obstacles.filter((obstacle) => obstacle.id !== id);
    setObstacles(next);
    saveObstacles(next);
  }

  function recenterToMyPosition() {
    if (!navigator.geolocation) {
      mapRef.current?.setView(DEFAULT_CENTER, 16, { animate: true });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextPosition: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setPosition(nextPosition);
        mapRef.current?.setView(nextPosition, 17, { animate: true });
      },
      () => mapRef.current?.setView(center, 16, { animate: true }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function geocodeLocation(query: string) {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = (await response.json()) as {
      found?: boolean;
      lat?: number;
      lon?: number;
      display_name?: string;
    };

    if (!response.ok || !data.found || typeof data.lat !== "number" || typeof data.lon !== "number") {
      return null;
    }

    return { lat: data.lat, lng: data.lon, label: data.display_name ?? query };
  }

  async function confirmDepartureAddress() {
    const query = departureAddressInput.trim();
    if (!query) return;

    setDepartureStatus("loading");
    setRouteError(null);

    try {
      const location = await geocodeLocation(query);

      if (!location) {
        setDepartureStatus("notfound");
        return;
      }

      setDepartureLocation({ label: location.label, coords: [location.lat, location.lng] });
      setDepartureStatus("idle");
      setSavedAddressId(null);
      mapRef.current?.setView([location.lat, location.lng], 14, { animate: true });
    } catch {
      setDepartureStatus("error");
    }
  }

  function selectSavedDeparture(id: string) {
    const address = savedAddresses.find((item) => item.id === id);
    if (!address) return;

    setSavedAddressId(id);
    setDepartureMode("saved");
    setDepartureLocation({ label: address.label, coords: [address.lat, address.lng] });
    setDepartureAddressInput(address.address);
    setDepartureStatus("idle");
    mapRef.current?.setView([address.lat, address.lng], 14, { animate: true });
  }

  function useCurrentDeparture() {
    if (!position) {
      setDepartureStatus("error");
      return;
    }

    setDepartureMode("current");
    setDepartureLocation({ label: "Lieu actuel", coords: position });
    setDepartureStatus("idle");
  }

  function saveDepartureAddress() {
    if (!departureLocation || departureMode !== "address") return;

    const label = departureAddressInput.trim() || departureLocation.label;
    const next = [
      {
        id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
        label,
        address: departureAddressInput.trim(),
        lat: departureLocation.coords[0],
        lng: departureLocation.coords[1],
      },
      ...savedAddresses,
    ].slice(0, 6);

    setSavedAddresses(next);
    saveSavedAddresses(next);
    setDepartureMode("saved");
    setSavedAddressId(next[0].id);
  }

  function loadRouteRecord(record: RouteRecord) {
    setDepartureLocation({ label: record.originLabel, coords: record.origin });
    setDestination({ lat: record.destination[0], lng: record.destination[1], label: record.destinationLabel });
    setRoute(null);
    setRouteError(null);
    setNavigationActive(false);
    setAddressInput("");
    setDepartureMode(record.originLabel === "Lieu actuel" ? "current" : "saved");
    setActiveTab("destination");
    mapRef.current?.setView(record.destination, 16, { animate: true });
  }

  function addCurrentRouteToFavorites() {
    if (!route || !destination) return;

    const title = `${departureLocation?.label ?? "Position actuelle"} → ${destination.label}`;
    if (favoriteRoutes.some((item) => item.title === title && item.destinationLabel === destination.label)) {
      return;
    }

    const favorite: RouteRecord = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      title,
      originLabel: departureLocation?.label ?? "Position actuelle",
      destinationLabel: destination.label,
      distance: route.distance,
      duration: route.duration,
      createdAt: new Date().toISOString(),
      origin: departureLocation?.coords ?? position ?? DEFAULT_CENTER,
      destination: [destination.lat, destination.lng],
    };

    const next = [favorite, ...favoriteRoutes].slice(0, 6);
    setFavoriteRoutes(next);
    saveFavoriteRoutes(next);
  }

  function removeFavoriteRoute(id: string) {
    const next = favoriteRoutes.filter((item) => item.id !== id);
    setFavoriteRoutes(next);
    saveFavoriteRoutes(next);
  }

  function addRecentRoute(routeData: RouteState) {
    if (!destination) return;

    const record: RouteRecord = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      title: `${departureLocation?.label ?? "Position actuelle"} → ${destination.label}`,
      originLabel: departureLocation?.label ?? "Position actuelle",
      destinationLabel: destination.label,
      distance: routeData.distance,
      duration: routeData.duration,
      createdAt: new Date().toISOString(),
      origin: departureLocation?.coords ?? position ?? DEFAULT_CENTER,
      destination: [destination.lat, destination.lng],
    };

    const next = [record, ...recentRoutes].slice(0, 6);
    setRecentRoutes(next);
    saveRecentRoutes(next);
  }

  async function confirmAddress() {
    const query = addressInput.trim();
    if (!query) return;

    setGeoStatus("loading");
    setRouteError(null);

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as {
        found?: boolean;
        lat?: number;
        lon?: number;
        display_name?: string;
      };

      if (!response.ok || !data.found || typeof data.lat !== "number" || typeof data.lon !== "number") {
        setGeoStatus("notfound");
        return;
      }

      setDestination({
        lat: data.lat,
        lng: data.lon,
        label: data.display_name ?? query,
      });
      setRoute(null);
      setCurrentStepIndex(0);
      setNavigationActive(false);
      setGeoStatus("idle");
      mapRef.current?.setView([data.lat, data.lon], 16, { animate: true });
    } catch {
      setGeoStatus("error");
    }
  }

  async function fetchRoute() {
    const origin = departureLocation?.coords ?? position;
    if (!origin || !destination) {
      setRouteError("Position ou destination manquante.");
      return;
    }

    setRouteStatus("loading");
    setRouteError(null);

    const params = new URLSearchParams({
      fromLat: String(origin[0]),
      fromLng: String(origin[1]),
      toLat: String(destination.lat),
      toLng: String(destination.lng),
      profile: profileForAid(selectedAid),
    });

    try {
      const response = await fetch(`/api/route?${params.toString()}`);
      const data = (await response.json()) as RouteState | { error?: string };

      if (!response.ok || !isRouteState(data)) {
        throw new Error("error" in data ? data.error : "Route failed");
      }

      setRoute(data);
      setCurrentStepIndex(0);
      setNavigationActive(true);
      addRecentRoute(data);

      if (data.coords.length > 0) {
        mapRef.current?.fitBounds(L.latLngBounds(data.coords), { padding: [64, 64] });
      }
      setRouteStatus("idle");
    } catch {
      setRouteStatus("error");
      setRouteError("Impossible de calculer l'itinéraire pour le moment.");
    }
  }

  function clearDestination() {
    setDestination(null);
    setAddressInput("");
    setGeoStatus("idle");
    setRoute(null);
    setRouteError(null);
    setNavigationActive(false);
    setCurrentStepIndex(0);
  }

  return (
    <main className="map-wrap">
      <nav className="sidebar" aria-label="Navigation rapide">
        <button
          type="button"
          className={`sidebar-item ${activeTab === "mode" ? "active" : ""}`}
          onClick={() => setActiveTab("mode")}
        >
          <span className="sidebar-icon" aria-hidden="true">≡</span>
          <span className="sidebar-label">Changer le mode</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === "departure" ? "active" : ""}`}
          onClick={() => setActiveTab("departure")}
        >
          <span className="sidebar-icon" aria-hidden="true">📍</span>
          <span className="sidebar-label">Lieu de départ</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === "recents" ? "active" : ""}`}
          onClick={() => setActiveTab("recents")}
        >
          <span className="sidebar-icon" aria-hidden="true">🕒</span>
          <span className="sidebar-label">Trajets récents</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === "favorites" ? "active" : ""}`}
          onClick={() => setActiveTab("favorites")}
        >
          <span className="sidebar-icon" aria-hidden="true">★</span>
          <span className="sidebar-label">Favoris</span>
        </button>
      </nav>

      <aside className="ui-panel" aria-label="Commandes HandiWay">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">HandiWay</p>
            <h1 className="ui-title">Carte accessible</h1>
          </div>
          <span className="aid-badge">{selectedAidLabel}</span>
        </div>

        <section className="panel-section" aria-labelledby="departure-title">
          <h2 id="departure-title">Lieu de départ</h2>
          <label className="field">
            <span>Type de départ</span>
            <select
              className="text-input"
              value={departureMode}
              onChange={(event) => {
                const value = event.target.value as "current" | "address" | "saved";
                setDepartureMode(value);
                setDepartureStatus("idle");
              }}
            >
              <option value="current">Lieu actuel</option>
              <option value="address">Adresse</option>
              <option value="saved">Adresse enregistrée</option>
            </select>
          </label>

          {departureMode === "current" && (
            <div className="button-row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={useCurrentDeparture} type="button">
                Utiliser mon lieu actuel
              </button>
            </div>
          )}

          {departureMode === "address" && (
            <>
              <div className="search-row">
                <input
                  aria-label="Adresse de départ"
                  className="text-input"
                  onChange={(event) => {
                    setDepartureAddressInput(event.target.value);
                    setDepartureStatus("idle");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmDepartureAddress();
                  }}
                  placeholder="Adresse de départ"
                  value={departureAddressInput}
                />
                <button
                  className="btn"
                  disabled={!departureAddressInput.trim() || departureStatus === "loading"}
                  onClick={confirmDepartureAddress}
                  type="button"
                >
                  {departureStatus === "loading" ? "..." : "OK"}
                </button>
              </div>
              <div className="button-row" style={{ marginTop: 10 }}>
                <button
                  className="btn ghost"
                  onClick={saveDepartureAddress}
                  disabled={!departureAddressInput.trim() || !departureLocation}
                  type="button"
                >
                  Enregistrer l'adresse
                </button>
              </div>
            </>
          )}

          {departureMode === "saved" && (
            <div className="button-row" style={{ flexDirection: "column", gap: "8px" }}>
              {savedAddresses.length === 0 ? (
                <p className="status">Aucune adresse enregistrée.</p>
              ) : (
                savedAddresses.map((address) => (
                  <button
                    key={address.id}
                    className={`btn ${savedAddressId === address.id ? "ghost" : ""}`}
                    onClick={() => selectSavedDeparture(address.id)}
                    type="button"
                  >
                    {address.label}
                  </button>
                ))
              )}
            </div>
          )}

          {(departureStatus === "notfound" || departureStatus === "error") && (
            <p className="status error">
              {departureStatus === "notfound"
                ? "Adresse de départ introuvable."
                : "Erreur pendant la recherche du départ."}
            </p>
          )}

          {departureLocation && (
            <p className="status" style={{ marginTop: 10 }}>
              Départ sélectionné : <strong>{departureLocation.label}</strong>
            </p>
          )}
        </section>

        <section className="panel-section" aria-labelledby="destination-title">
          <h2 id="destination-title">Destination</h2>
          <div className="search-row">
            <input
              aria-label="Adresse ou destination"
              className="text-input"
              onChange={(event) => {
                setAddressInput(event.target.value);
                setGeoStatus("idle");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmAddress();
              }}
              placeholder="10 rue de Rivoli, Paris"
              value={addressInput}
            />
            <button className="btn" disabled={!addressInput.trim() || geoStatus === "loading"} onClick={confirmAddress} type="button">
              {geoStatus === "loading" ? "..." : "OK"}
            </button>
          </div>

          {geoStatus === "notfound" && <p className="status error">Adresse introuvable.</p>}
          {geoStatus === "error" && <p className="status error">Erreur pendant la recherche.</p>}

          {destination && (
            <div className="destination-card">
              <p>{destination.label}</p>
              <div className="button-row">
                <button className="btn ghost" onClick={() => mapRef.current?.setView([destination.lat, destination.lng], 16)} type="button">
                  Voir
                </button>
                <button className="btn ghost" onClick={clearDestination} type="button">
                  Effacer
                </button>
                <button className="btn" disabled={routeStatus === "loading"} onClick={fetchRoute} type="button">
                  {routeStatus === "loading" ? "Calcul..." : "Itinéraire"}
                </button>
              </div>
            </div>
          )}

          {routeError && <p className="status error">{routeError}</p>}

          {route && (
            <div className="route-summary">
              <strong>
                {formatDistance(route.distance)} · {formatDuration(route.duration)}
              </strong>
              {nearbyObstacles.length > 0 && (
                <span>{nearbyObstacles.length} obstacle(s) signalé(s) près du trajet.</span>
              )}
              {nextStep && <span>Prochaine étape : {nextStep.instruction}</span>}
              <div className="button-row">
                <button
                  className="btn ghost"
                  onClick={() => setNavigationActive((active) => !active)}
                  type="button"
                >
                  {navigationActive ? "Arrêter navigation" : "Démarrer navigation"}
                </button>
                <button
                  className="btn ghost"
                  onClick={addCurrentRouteToFavorites}
                  type="button"
                >
                  Ajouter aux favoris
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel-section" aria-labelledby="quick-nav-title">
          <h2 id="quick-nav-title">Navigation rapide</h2>
          {activeTab === "recents" && (
            <div className="button-row" style={{ flexDirection: "column", gap: "12px" }}>
              {recentRoutes.length === 0 ? (
                <p className="status">Aucun trajet récent.</p>
              ) : (
                recentRoutes.map((item) => (
                  <div key={item.id} className="destination-card">
                    <strong>{item.title}</strong>
                    <span>{formatDistance(item.distance)} · {formatDuration(item.duration)}</span>
                    <span>Le {new Date(item.createdAt).toLocaleDateString('fr-FR')}</span>
                    <div className="button-row" style={{ marginTop: 10 }}>
                      <button className="btn ghost" onClick={() => loadRouteRecord(item)} type="button">
                        Charger
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "favorites" && (
            <div className="button-row" style={{ flexDirection: "column", gap: "12px" }}>
              {favoriteRoutes.length === 0 ? (
                <p className="status">Aucun favoris ajouté.</p>
              ) : (
                favoriteRoutes.map((item) => (
                  <div key={item.id} className="destination-card">
                    <strong>{item.title}</strong>
                    <span>{formatDistance(item.distance)} · {formatDuration(item.duration)}</span>
                    <div className="button-row" style={{ marginTop: 10 }}>
                      <button className="btn ghost" onClick={() => loadRouteRecord(item)} type="button">
                        Charger
                      </button>
                      <button className="btn ghost" onClick={() => removeFavoriteRoute(item.id)} type="button">
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {(activeTab === "mode" || activeTab === "departure" || activeTab === "destination") && (
            <p className="status">Sélectionnez « Trajets récents » ou « Favoris » à gauche pour charger un trajet.</p>
          )}
        </section>

        <section className="panel-section" aria-labelledby="report-title">
          <h2 id="report-title">Signalements</h2>
          <p className="status">
            {reportMode ? "Cliquez sur la carte pour placer un obstacle." : `${obstacles.length} obstacle(s) enregistré(s).`}
          </p>
          <div className="button-row">
            <button className={`btn ${reportMode ? "ghost" : ""}`} onClick={() => setReportMode((value) => !value)} type="button">
              {reportMode ? "Annuler" : "Signaler"}
            </button>
            <button className="btn ghost" onClick={recenterToMyPosition} type="button">
              Ma position
            </button>
          </div>
        </section>
      </aside>

      <MapContainer
        center={center}
        className="map"
        ref={(map) => {
          mapRef.current = map;
        }}
        zoom={16}
        zoomControl={false}
      >
        <ZoomControl position="topright" />
        <ClickToAddObstacle enabled={reportMode} onPick={openDraft} />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {route && route.coords.length > 0 && (
          <Polyline positions={route.coords} pathOptions={{ color: "#0f766e", weight: 7, opacity: 0.86 }} />
        )}

        {destination && (
          <Marker icon={destinationIcon} position={[destination.lat, destination.lng]}>
            <Popup>
              <strong>Destination</strong>
              <p>{destination.label}</p>
            </Popup>
          </Marker>
        )}

        <Marker icon={userIcon} position={center}>
          <Popup>Votre position</Popup>
        </Marker>

        {obstacles.map((obstacle) => (
          <Marker icon={obstacleIcon} key={obstacle.id} position={[obstacle.lat, obstacle.lng]}>
            <Popup>
              <div className="popup-content">
                <strong>{obstacle.type}</strong>
                <p>{obstacle.description || "Aucune description."}</p>
                <button className="popup-delete" onClick={() => removeObstacle(obstacle.id)} type="button">
                  Supprimer
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {draft && (
        <div className="modal-backdrop" onMouseDown={cancelDraft}>
          <form
            className="modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
          >
            <h2 className="modal-title">Nouveau signalement</h2>

            <label className="field">
              <span>Type obstacle</span>
              <select
                onChange={(event) => setDraft({ ...draft, type: event.target.value as ObstacleType })}
                value={draft.type}
              >
                {obstacleTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Description</span>
              <textarea
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Ex : escalier sans rampe, travaux, trottoir très étroit..."
                rows={3}
                value={draft.description}
              />
            </label>

            <div className="modal-actions">
              <button className="btn ghost" onClick={cancelDraft} type="button">
                Annuler
              </button>
              <button className="btn" type="submit">
                Enregistrer
              </button>
            </div>

            <p className="hint">
              Coordonnées : {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
            </p>
          </form>
        </div>
      )}
    </main>
  );
}
