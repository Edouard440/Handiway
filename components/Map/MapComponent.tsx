"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";

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

export default function MapComponent() {
  const mapRef = useRef<L.Map | null>(null);

  const [pos, setPos] = useState<[number, number] | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [draft, setDraft] = useState<{
    lat: number;
    lng: number;
    type: ObstacleType;
    description: string;
  } | null>(null);

  const [reportMode, setReportMode] = useState(false);

  const fallback: [number, number] = [48.8566, 2.3522]; // Paris
  const center = pos ?? fallback;

  useEffect(() => {
    setObstacles(loadObstacles());
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPos([p.coords.latitude, p.coords.longitude]),
      () => setPos(fallback),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

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
        map.setView(me, 17, { animate: true });
      },
      () => {
        map.setView(center, 16, { animate: true });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="map-wrap">
      <div className="ui-panel">
        <div className="ui-title">HandiWay — Signalement</div>

        <div className="ui-sub" style={{ marginBottom: 10 }}>
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
        ref={(ref) => {
          mapRef.current = ref;
        }}
      >
        <ClickToAddObstacle enabled={reportMode} onPick={openDraft} />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={center} icon={DefaultIcon}>
          <Popup>Ta position</Popup>
        </Marker>

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