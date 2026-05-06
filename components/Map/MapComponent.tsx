"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";

type MobilityAid =
  | "wheelchair"
  | "scooter"
  | "walker"
  | "cane"
  | "crutches"
  | "prosthetic";

type MapComponentProps = {
  selectedAid: MobilityAid | null;
};

type ObstacleType =
  | "Escaliers"
  | "Ascenseur en panne"
  | "Trottoir dégradé"
  | "Pente trop forte"
  | "Autre";

type Obstacle = {
  id: string;
  type: ObstacleType;
  description: string;
  lat: number;
  lng: number;
  createdAt: string;
};

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const STORAGE_KEY = "handiway_obstacles_v1";

function loadObstacles(): Obstacle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Obstacle[];
  } catch {
    return [];
  }
}

function saveObstacles(obstacles: Obstacle[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obstacles));
}

function ClickToAddObstacle(props: {
  enabled: boolean;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!props.enabled) return;
      props.onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapComponent({ selectedAid }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);

  const [pos, setPos] = useState<[number, number] | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>(() => loadObstacles());
  const [draft, setDraft] = useState<{
    lat: number;
    lng: number;
    type: ObstacleType;
    description: string;
  } | null>(null);

  const [reportMode, setReportMode] = useState(false);

  // Routing
  const [route, setRoute] = useState<{
    coords: [number, number][];
    distance: number;
    duration: number;
    steps: {
      instruction: string;
      distance: number;
      duration: number;
      location: [number, number];
    }[];
  } | null>(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Destination (adresse)
  const [addressInput, setAddressInput] = useState("");
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [dest, setDest] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "notfound" | "error">("idle");

  const fallback = useMemo(() => [48.8566, 2.3522] as [number, number], []);
  const center = pos ?? fallback;

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPos([p.coords.latitude, p.coords.longitude]),
      () => setPos(fallback),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [fallback]);

  const typeOptions: ObstacleType[] = useMemo(
    () => ["Escaliers", "Ascenseur en panne", "Trottoir dégradé", "Pente trop forte", "Autre"],
    []
  );

  function openDraft(lat: number, lng: number) {
    setDraft({ lat, lng, type: "Trottoir dégradé", description: "" });
  }

  function cancelDraft() {
    setDraft(null);
    setReportMode(false);
  }

  function submitDraft() {
    if (!draft) return;

    const newObstacle: Obstacle = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type: draft.type,
      description: draft.description.trim(),
      lat: draft.lat,
      lng: draft.lng,
      createdAt: new Date().toISOString(),
    };

    const next = [newObstacle, ...obstacles];
    setObstacles(next);
    saveObstacles(next);

    setDraft(null);
    setReportMode(false);
  }

  function removeObstacle(id: string) {
    const next = obstacles.filter((o) => o.id !== id);
    setObstacles(next);
    saveObstacles(next);
  }

  function recenterToMyPosition() {
    const map = mapRef.current;
    if (!map) return;

    if (!navigator.geolocation) {
      map.setView(fallback, 16, { animate: true });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (p) => {
        const me: [number, number] = [p.coords.latitude, p.coords.longitude];
        setPos(me);
        setUserLocation(me);
        map.setView(me, 17, { animate: true });
      },
      () => {
        map.setView(center, 16, { animate: true });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  const metersBetween = ([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const buildInstructions = (steps: any[]) =>
    steps.map((step) => ({
      instruction: step.maneuver.instruction || step.name || "Continue",
      distance: step.distance || 0,
      duration: step.duration || 0,
      location: [step.maneuver.location[1], step.maneuver.location[0]] as [number, number],
    }));

  async function fetchRoute() {
    setRouteError(null);

    if (!pos || !dest) {
      setRouteError("Position ou destination manquante");
      return;
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setRouteError("MAPBOX TOKEN manquant. Ajouter NEXT_PUBLIC_MAPBOX_TOKEN dans .env.local");
      return;
    }

    const profile =
      selectedAid === "walker" || selectedAid === "cane" || selectedAid === "crutches"
        ? "walking"
        : selectedAid === "scooter"
        ? "driving-traffic"
        : selectedAid === "wheelchair" || selectedAid === "prosthetic"
        ? "driving"
        : "driving-traffic";

    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${pos[1]},${pos[0]};${dest.lng},${dest.lat}?geometries=geojson&steps=true&overview=full&annotations=distance,duration,congestion&access_token=${token}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Mapbox route fail ${res.status}`);
      const json = await res.json();
      const routeData = json.routes?.[0];
      if (!routeData) {
        setRouteError("Aucune route trouvée");
        return;
      }

      const coords = (routeData.geometry.coordinates as [number, number][]).map((c) => [c[1], c[0]] as [number, number]);
      const steps = routeData.legs?.[0]?.steps ? buildInstructions(routeData.legs[0].steps) : [];

      setRoute({
        coords,
        distance: routeData.distance || 0,
        duration: routeData.duration || 0,
        steps,
      });
      setCurrentStepIndex(0);
      setNavigationActive(true);

      const map = mapRef.current;
      if (map) {
        const bounds = L.latLngBounds(coords as [number, number][]);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } catch (error) {
      console.error(error);
      setRouteError("Impossible de charger l'itinéraire");
    }
  }

  useEffect(() => {
    if (!navigationActive || !navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const me: [number, number] = [p.coords.latitude, p.coords.longitude];
        setPos(me);
        setUserLocation(me);

        const map = mapRef.current;
        if (map) map.panTo(me, { animate: true });

        if (!route) return;

        const nextStep = route.steps[currentStepIndex];
        if (nextStep) {
          const dist = metersBetween(me, nextStep.location);
          if (dist < 20) {
            setCurrentStepIndex((i) => Math.min(i + 1, route.steps.length - 1));
          }
        }

        const distToRoute = route.coords.reduce((min, p) => Math.min(min, metersBetween(me, p)), Infinity);
        if (distToRoute > 35) {
          fetchRoute();
        }
      },
      (err) => {
        console.warn(err);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [navigationActive, route, currentStepIndex]);

  async function confirmAddress() {
    const q = (pendingAddress ?? "").trim();
    if (!q) return;

    const map = mapRef.current;
    setGeoStatus("loading");

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (!data?.found) {
        setGeoStatus("notfound");
        return;
      }

      const lat = Number(data.lat);
      const lng = Number(data.lon);
      const label = String(data.display_name ?? q);

      setDest({ lat, lng, label });
      setGeoStatus("idle");

      if (map) map.setView([lat, lng], 16, { animate: true });
    } catch {
      setGeoStatus("error");
    }
  }

  return (
    <div className="map-wrap">
      <div className="ui-panel">
        <div className="ui-title">HandiWay</div>

        <div className="ui-sub" style={{ marginTop: 6 }}>
          Aide : {selectedAid ?? "non définie"}
        </div>

        {/* Adresse */}
        <div style={{ marginTop: 10 }}>
          <div className="ui-sub" style={{ marginBottom: 6 }}>
            Adresse / destination
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={addressInput}
              onChange={(e) => {
                const v = e.target.value;
                setAddressInput(v);
                setPendingAddress(v.trim() ? v : null);
                setGeoStatus("idle");
              }}
              placeholder="Ex: 10 rue de Rivoli, Paris"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(0,0,0,0.35)",
                color: "white",
                outline: "none",
              }}
            />

            {pendingAddress && (
              <button className="btn" onClick={confirmAddress} disabled={geoStatus === "loading"}>
                {geoStatus === "loading" ? "..." : "Confirmer"}
              </button>
            )}
          </div>

          {geoStatus === "notfound" && (
            <div className="ui-sub" style={{ marginTop: 6 }}>
              Adresse introuvable.
            </div>
          )}
          {geoStatus === "error" && (
            <div className="ui-sub" style={{ marginTop: 6 }}>
              Erreur de recherche.
            </div>
          )}

          {dest && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn ghost"
                onClick={() => {
                  const map = mapRef.current;
                  if (map) map.setView([dest.lat, dest.lng], 16, { animate: true });
                }}
              >
                Aller à la destination
              </button>

              <button
                className="btn ghost"
                onClick={() => {
                  setDest(null);
                  setAddressInput("");
                  setPendingAddress(null);
                  setGeoStatus("idle");
                }}
              >
                Effacer
              </button>

              <button className="btn" onClick={fetchRoute}>
                Calculer itinéraire
              </button>

              {navigationActive ? (
                <button className="btn ghost" onClick={() => setNavigationActive(false)}>
                  Arrêter navigation
                </button>
              ) : (
                <button
                  className="btn"
                  onClick={() => {
                    if (!route) {
                      fetchRoute();
                      return;
                    }
                    setNavigationActive(true);
                  }}
                >
                  Démarrer navigation
                </button>
              )}
            </div>
          )}

          {routeError && (
            <div className="ui-sub" style={{ marginTop: 8, color: "#ff7b7b" }}>
              {routeError}
            </div>
          )}

          {route && (
            <>
              <div className="ui-sub" style={{ marginTop: 8 }}>
                Itinéraire : {(route.distance / 1000).toFixed(1)} km • {(route.duration / 60).toFixed(0)} min
              </div>
              {route.steps.length > 0 && (
                <div className="ui-sub" style={{ marginTop: 4 }}>
                  Prochaine étape : {route.steps[currentStepIndex]?.instruction ?? "..."}
                </div>
              )}
            </>
          )}
        </div>

        {/* Signalement */}
        <div className="ui-sub" style={{ marginTop: 12, marginBottom: 10 }}>
          {reportMode
            ? "Mode signalement activé : clique sur la carte."
            : "Clique sur “Signaler” pour ajouter un obstacle."}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className={`btn ${reportMode ? "ghost" : ""}`}
            onClick={() => setReportMode((v) => !v)}
          >
            {reportMode ? "Annuler" : "Signaler"}
          </button>

          <button className="btn ghost" onClick={recenterToMyPosition}>
            Ma position
          </button>
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={16}
        className="map"
        zoomControl={false}
        ref={(ref) => {
          mapRef.current = ref;
        }}
      >
        <ZoomControl position="topright" />

        <ClickToAddObstacle enabled={reportMode} onPick={openDraft} />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {route && route.coords.length > 0 && (
          <Polyline
            positions={route.coords}
            pathOptions={{ color: "#76c7ff", weight: 7, opacity: 0.85 }}
          />
        )}

        {dest && (
          <Marker position={[dest.lat, dest.lng]} icon={DefaultIcon}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>Destination</div>
                <div style={{ marginTop: 6 }}>{dest.label}</div>
              </div>
            </Popup>
          </Marker>
        )}

        {(userLocation ?? center) && (
          <Marker position={userLocation ?? center} icon={DefaultIcon}>
            <Popup>Vous</Popup>
          </Marker>
        )}

        {obstacles.map((o) => (
          <Marker key={o.id} position={[o.lat, o.lng]} icon={DefaultIcon}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>{o.type}</div>
                {o.description ? (
                  <div style={{ marginTop: 6 }}>{o.description}</div>
                ) : (
                  <div style={{ marginTop: 6, fontStyle: "italic", opacity: 0.8 }}>
                    (pas de description)
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => removeObstacle(o.id)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.2)",
                      cursor: "pointer",
                      background: "transparent",
                      color: "white",
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {draft && (
        <div className="modal-backdrop" onMouseDown={cancelDraft}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">Nouveau signalement</div>

            <label className="field">
              <span>Type d’obstacle</span>
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft({ ...draft, type: e.target.value as ObstacleType })
                }
              >
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Description (optionnel)</span>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Ex: escalier sans rampe, travaux, trottoir très étroit…"
                rows={3}
              />
            </label>

            <div className="modal-actions">
              <button className="btn ghost" onClick={cancelDraft}>
                Annuler
              </button>
              <button className="btn" onClick={submitDraft}>
                Enregistrer
              </button>
            </div>

            <div className="hint">
              Coordonnées: {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}