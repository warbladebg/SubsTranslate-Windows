import { AlertTriangle, ArrowLeft, Check, CheckCircle2, CloudDownload, Compass, ExternalLink, Film, FolderOpen, Loader2, Magnet, RefreshCw, Save, Settings, Trash2 } from "lucide-react";
import {
  DEBRID_PROVIDERS,
  type DebridProvider,
  type DiscoveryCredentialStatus,
  type DiscoveryPreferences,
  type OtherDebridProvider,
  type RealDebridConnectionStatus
} from "../../../core/discovery/DiscoveryTypes";
import type { DownloadLocationState } from "../../../core/downloads/DownloadLocations";
import { debridProviderName } from "./discoveryFormatting";
import { formatShortDate } from "../../format";

interface SettingsProps {
  preferences: DiscoveryPreferences;
  credentials: DiscoveryCredentialStatus;
  downloadLocations?: DownloadLocationState;
  realDebridStatus?: RealDebridConnectionStatus;
  realDebridToken: string;
  otherDebridTokens: Record<string, string>;
  mdblistApiKey: string;
  saving: boolean;
  clearingHistory: boolean;
  locationBusy: string;
  error?: string;
  notice?: string;
  backButtonRef: React.RefObject<HTMLButtonElement>;
  onPreferencesChange: (preferences: DiscoveryPreferences) => void;
  onRealDebridTokenChange: (value: string) => void;
  onOtherDebridTokenChange: (provider: OtherDebridProvider, value: string) => void;
  onMdblistApiKeyChange: (value: string) => void;
  onAddDownloadLocation: () => void;
  onSetDefaultDownloadLocation: (id: string) => void;
  onSetDownloadLocationExternal: (id: string, external: boolean) => void;
  onRemoveDownloadLocation: (id: string) => void;
  onScanExternalDownloadLocations: () => void;
  onSave: () => void;
  onDisconnectRealDebrid: () => void;
  onDisconnectOtherDebrid: (provider: OtherDebridProvider) => void;
  onDisconnectMdblist: () => void;
  onClearHistory: () => void;
  onBack: () => void;
}

export function DiscoverySettings(props: SettingsProps) {
  const debridProvider = props.preferences.debridProvider ?? "real-debrid";
  return (
    <section className="panel discovery-settings" aria-labelledby="discovery-settings-title">
      <div className="panel-header">
        <div>
          <button
            className="text-button discovery-settings-back"
            ref={props.backButtonRef}
            onClick={props.onBack}
            type="button"
          >
            <ArrowLeft size={16} />
            Back to Discover
          </button>
          <h2 id="discovery-settings-title"><Settings size={18} /> Discovery & downloads</h2>
          <p>Metadata works automatically. Optional download credentials are OS-encrypted; preferences stay local.</p>
        </div>
        <button className="primary-button" onClick={props.onSave} disabled={props.saving} type="button">
          {props.saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          Save settings
        </button>
      </div>

      {props.error && (
        <div className="notice error discovery-settings-notice" role="alert">
          <AlertTriangle size={18} />
          <span>{props.error}</span>
        </div>
      )}
      {props.notice && (
        <div className="notice success discovery-settings-notice" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span>{props.notice}</span>
        </div>
      )}

      <div className="discovery-settings-grid">
        <section className="settings-section">
          <div className="settings-section-header">
            <Film size={16} />
            <h3>Ratings & metadata</h3>
            <span className={props.credentials.hasMdblistApiKey ? "status-pill ok" : "status-pill warn"}>
              {props.credentials.hasMdblistApiKey ? "Multi-source" : "IMDb only"}
            </span>
          </div>
          <p className="settings-help">
            Core title data and IMDb scores load automatically. Add an MDBList key for Rotten Tomatoes,
            Metacritic, Letterboxd, Trakt, TMDB, and other available ratings.
          </p>
          <label>
            MDBList API key
            <input
              type="password"
              value={props.mdblistApiKey}
              onChange={(event) => props.onMdblistApiKeyChange(event.target.value)}
              placeholder={props.credentials.hasMdblistApiKey ? "Stored with OS encryption" : "Paste your MDBList API key"}
              autoComplete="off"
            />
          </label>
          <div className="button-row">
            <button
              className="text-button"
              onClick={() => window.subtitleTranslator.openMdblistApiKeyPage()}
              type="button"
            >
              <ExternalLink size={15} />
              Get API key
            </button>
            {props.credentials.hasMdblistApiKey && (
              <button className="text-button danger-button" onClick={props.onDisconnectMdblist} type="button">
                Disconnect
              </button>
            )}
          </div>
          <small>Scores are loaded from MDBList only when a key is connected and are cached for 24 hours.</small>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <CloudDownload size={16} />
            <h3>Debrid service</h3>
          </div>
          <label>
            Download provider
            <select
              value={debridProvider}
              onChange={(event) => props.onPreferencesChange({
                ...props.preferences,
                debridProvider: event.target.value as DebridProvider
              })}
            >
              {DEBRID_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{debridProviderName(provider)}</option>
              ))}
            </select>
          </label>
          {debridProvider === "real-debrid" ? (
            <>
              <span className={props.realDebridStatus?.connected ? "status-pill ok" : "status-pill warn"}>
                {props.realDebridStatus?.connected
                  ? `${props.realDebridStatus.username ?? "Connected"} · ${props.realDebridStatus.accountType ?? "account"}`
                  : props.credentials.hasRealDebridToken ? "Connected key stored" : "Token missing"}
              </span>
              <label>
                Personal API token
                <input
                  type="password"
                  value={props.realDebridToken}
                  onChange={(event) => props.onRealDebridTokenChange(event.target.value)}
                  placeholder={props.credentials.hasRealDebridToken ? "Stored with OS encryption" : "Paste a local-app API token"}
                  autoComplete="off"
                />
              </label>
              {props.realDebridStatus?.premiumUntil && (
                <small>Premium until {formatShortDate(props.realDebridStatus.premiumUntil, props.realDebridStatus.premiumUntil)}</small>
              )}
              {props.credentials.hasRealDebridToken && (
                <button className="text-button danger-button" onClick={props.onDisconnectRealDebrid} type="button">
                  Disconnect Real-Debrid
                </button>
              )}
            </>
          ) : (
            <OtherDebridCredentials
              provider={debridProvider}
              hasKey={Boolean(props.credentials.hasDebridTokens?.[debridProvider])}
              token={props.otherDebridTokens[debridProvider] ?? ""}
              onTokenChange={(value) => props.onOtherDebridTokenChange(debridProvider, value)}
              onDisconnect={() => props.onDisconnectOtherDebrid(debridProvider)}
            />
          )}
          <small>Each service needs its own API key. Real-Debrid keys work with Torrentio and Comet when Real-Debrid is selected.</small>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <Compass size={16} />
            <h3>Recommendations</h3>
          </div>
          <div className="settings-form-grid">
            <label>
              Content
              <select
                value={props.preferences.preferredMediaType}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  preferredMediaType: event.target.value as DiscoveryPreferences["preferredMediaType"]
                })}
              >
                <option value="all">Movies and TV</option>
                <option value="movie">Movies</option>
                <option value="series">TV shows</option>
              </select>
            </label>
            <label>
              Region
              <input
                value={props.preferences.region}
                maxLength={2}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  region: event.target.value.toUpperCase()
                })}
              />
            </label>
            <label>
              Language
              <input
                value={props.preferences.language}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  language: event.target.value
                })}
              />
            </label>
          </div>
          <button
            className="text-button danger-button"
            onClick={props.onClearHistory}
            disabled={props.clearingHistory}
            type="button"
          >
            <Trash2 size={15} />
            Clear taste and watch history
          </button>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <Magnet size={16} />
            <h3>Torrent results</h3>
            <span className="status-pill ok">Ready</span>
          </div>
          <p className="settings-help">
            Choose a community maintained source. Scraper results are unverified metadata; inspect the release and files before opening a torrent.
          </p>
          <div className="settings-form-grid">
            <label>
              Torrent scraper
              <select
                value={props.preferences.sourceProvider ?? "torrentio"}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  sourceProvider: event.target.value as DiscoveryPreferences["sourceProvider"]
                })}
              >
                <option value="torrentio">Torrentio</option>
                <option value="comet">Comet</option>
                <option value="mediafusion">MediaFusion</option>
              </select>
            </label>
            <label>
              Maximum size (GB, 0 = unlimited)
              <input
                type="number"
                min="0"
                max="1000"
                value={props.preferences.maxSizeGb}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  maxSizeGb: Number(event.target.value)
                })}
              />
            </label>
            <label>
              Minimum seeders
              <input
                type="number"
                min="0"
                value={props.preferences.minSeeders}
                onChange={(event) => props.onPreferencesChange({
                  ...props.preferences,
                  minSeeders: Number(event.target.value)
                })}
              />
            </label>
          </div>
          <small>
            Searches share the title or episode IMDb ID and your IP address with the selected scraper. Use torrent downloads only
            for media you are legally entitled to access.
          </small>
        </section>

        <section className="settings-section download-libraries-section">
          <div className="settings-section-header">
            <FolderOpen size={16} />
            <h3>Download libraries</h3>
            <span className="status-pill ok">
              {props.downloadLocations?.locations.filter((location) => location.isAvailable).length ?? 0} available
            </span>
          </div>
          <p className="settings-help">
            Add folders on any drive. SubsTranslate creates and manages Movies and TV Shows inside each location.
          </p>
          <div className="download-location-list">
            {props.downloadLocations?.locations.map((location) => (
              <article className={`download-location-card${location.isAvailable ? "" : " missing"}`} key={location.id}>
                <div className="download-location-heading">
                  <div>
                    <strong>{location.label}</strong>
                    <span className={`status-pill ${location.isAvailable ? "ok" : "warn"}`}>
                      {location.isAvailable ? "Available" : "Not connected"}
                    </span>
                    {location.isDefault && <span className="status-pill ok">Default</span>}
                  </div>
                  <code>{location.path}</code>
                </div>
                <div className="download-location-controls">
                  <label className="download-location-external">
                    <input
                      type="checkbox"
                      checked={location.isExternal}
                      disabled={!location.isAvailable || Boolean(props.locationBusy)}
                      onChange={(event) => props.onSetDownloadLocationExternal(location.id, event.target.checked)}
                    />
                    External / removable drive
                  </label>
                  <div className="button-row">
                    {!location.isDefault && (
                      <button
                        className="text-button"
                        disabled={!location.isAvailable || Boolean(props.locationBusy)}
                        onClick={() => props.onSetDefaultDownloadLocation(location.id)}
                        type="button"
                      >
                        <Check size={15} />
                        Make default
                      </button>
                    )}
                    {location.isAvailable && (
                      <button
                        className="text-button"
                        onClick={() => window.subtitleTranslator.showItemInFolder(location.path)}
                        type="button"
                      >
                        <FolderOpen size={15} />
                        Open
                      </button>
                    )}
                    <button
                      aria-label={`Remove ${location.label}`}
                      className="text-button danger-button"
                      disabled={(props.downloadLocations?.locations.length ?? 0) <= 1 || Boolean(props.locationBusy)}
                      onClick={() => props.onRemoveDownloadLocation(location.id)}
                      type="button"
                    >
                      <Trash2 size={15} />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="button-row">
            <button
              className="text-button"
              disabled={Boolean(props.locationBusy)}
              onClick={props.onAddDownloadLocation}
              type="button"
            >
              {props.locationBusy === "location:add" ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} />}
              Add location
            </button>
            <button
              className="text-button"
              disabled={Boolean(props.locationBusy)}
              onClick={props.onScanExternalDownloadLocations}
              type="button"
            >
              {props.locationBusy === "location:scan" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
              Find external drives
            </button>
          </div>
          <small>
            External libraries are identified by a private marker inside their .substranslate folder, so they can be
            rediscovered after Windows assigns a different drive letter. Removing a location never deletes files.
          </small>
        </section>
      </div>
    </section>
  );
}

function OtherDebridCredentials({ provider, hasKey, token, onTokenChange, onDisconnect }: {
  provider: OtherDebridProvider;
  hasKey: boolean;
  token: string;
  onTokenChange: (value: string) => void;
  onDisconnect: () => void;
}) {
  const name = debridProviderName(provider);
  return (
    <>
      <span className={hasKey ? "status-pill ok" : "status-pill warn"}>
        {hasKey ? "Connected key stored" : "Key missing"}
      </span>
      <label>
        {name} API key
        <input
          type="password"
          value={token}
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder={hasKey ? "Stored with OS encryption" : "Paste API key"}
          autoComplete="off"
        />
      </label>
      {hasKey && (
        <button className="text-button danger-button" onClick={onDisconnect} type="button">
          Disconnect {name}
        </button>
      )}
    </>
  );
}
