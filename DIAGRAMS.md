# Circeco System Diagrams

Visuals below capture the same architecture described in `ARCHITECTURE.md`, but translate it into Mermaid diagrams for quick onboarding, debugging, and data-trace exercises.

## Flow Control (routing → persistence)
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Router as Angular Router
    participant Landing as LandingComponent / AtlasComponent
    participant MapCmp as MapComponent
    participant MapSvc as MapService
    participant Places as PlacesFilter
    participant Fav as FavoritesService
    participant Store as Firebase Firestore

    User->>Router: Navigate to `/` or `/atlas`
    Router->>Landing: Instantiate landing page
    Router->>MapCmp: Navigate to `/atlas` → instantiate MapComponent via Atlas page
    MapCmp->>MapSvc: `init(container)`
    MapSvc-->>MapCmp: `onReady()` + feature stream
    MapCmp->>Places: `setAllFeatures()`
    Places-->>MapCmp: `filteredFeatures$`
    User->>MapCmp: Toggle filters / favorites
    MapCmp->>MapSvc: `setCategoryFilter()` / `setFavoritesVisibility()`
    MapCmp->>Fav: Favorite/unfavorite place
    Fav->>Store: `setDoc` / `deleteDoc`
    Store-->>Fav: Snapshot updates
    Fav-->>MapSvc: Update `favorites` source
    Fav-->>MapCmp: DOM events (`favorites:update`, `favorites:auth`)
```

## Data Lineage (places list & favorites)
```mermaid
graph LR
    subgraph Assets
        Geo[circular_places.geojson]
        Env[environment/emailjs/firebase]
    end
    subgraph Services
        MapSvc(MapService)
        Places(PlacesFilter)
        Fav(FavoritesService)
        Auth(AuthService)
    end
    subgraph View
        MapCmp(MapComponent)
        Footer(FooterComponent)
        Login(LoginComponent)
    end
    Geo --> MapSvc
    MapSvc -->|visible features| Places
    Places -->|enriched, deduped list| MapCmp
    MapCmp -->|UI filter text| Places
    MapCmp -->|favorite intent| Fav
    Fav -->|GeoJSON favorites source| MapSvc
    Fav -->|events| MapCmp
    Auth --> Fav
    Auth --> Login
    Login --> Auth
    Footer --> Env
```

## Component Structure (high-level topology)
```mermaid
graph TD
    subgraph Shell
        App(AppComponent)
        Router(Standalone Routes)
    end
    subgraph Pages
        Landing(LandingComponent)
        Atlas(AtlasComponent)
    end
    subgraph Feature Components
        Navbar(NavbarComponent)
        MapCmp(MapComponent)
        Footer(FooterComponent)
        Login(LoginComponent)
    end
    subgraph Model Services
        MapSvc(MapService)
        PlacesSvc(PlacesFilter)
        FavSvc(FavoritesService)
        AuthSvc(AuthService)
    end
    App --> Router --> Landing
    Router --> Atlas
    Landing --> Footer
    Atlas --> MapCmp
    App --> Navbar
    App --> Login
    Navbar --> AuthSvc
    Login --> AuthSvc
    MapCmp --> MapSvc
    MapCmp --> PlacesSvc
    MapCmp --> FavSvc
    FavSvc --> MapSvc
    AuthSvc --> FavSvc
```

## Favorites + Filtering (service handshake)
```mermaid
sequenceDiagram
    autonumber
    participant MapCmp as MapComponent
    participant MapSvc as MapService
    participant Places as PlacesFilter
    participant Fav as FavoritesService
    participant Auth as AuthService
    participant Firestore as Firestore users/{uid}/favourites
    participant PlacesSrc as Mapbox Source "places"
    participant FavSrc as Mapbox Source "favorites"

    MapCmp->>MapSvc: `init(mapHost)`
    MapSvc->>PlacesSrc: `addSource('places', circular_places.geojson)`
    MapSvc->>FavSrc: `addSource('favorites', empty FeatureCollection)`
    MapSvc-->>MapCmp: `onReady()` + `queryRenderedFeatures$()`
    MapCmp->>Places: `setAllFeatures(rendered)`
    Places-->>MapCmp: `filteredFeatures$` for UI list
    Places-->>MapSvc: `enabledCategories$` ⇒ `setCategoryFilter()`
    MapCmp->>MapSvc: `setFavoritesVisibility(toggled)`

    MapCmp->>Fav: `mountHeartButton()` wires favorite clicks
    Fav->>Auth: request `user$`
    Auth-->>Fav: emit `user$` stream
    Auth-->>MapCmp: DOM event `favorites:auth`
    Fav->>Auth: `openModal()` if user missing

    Fav->>Firestore: `setDoc()` / `deleteDoc()`
    Firestore-->>Fav: `collectionData()` snapshot
    Fav->>FavSrc: `pushToMapSource()` ⇒ `setData(...)`
    Fav-->>MapCmp: DOM event `favorites:update` (keys → paint/filter)
    Fav-->>MapCmp: DOM event `favorites-ready`
```

## Favorites Chronology (page load)
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as AppComponent
    participant Auth as AuthService
    participant Fav as FavoritesService
    participant MapCmp as MapComponent
    participant MapSvc as MapService
    participant Places as PlacesFilter
    participant Firestore as Firestore
    participant PlacesSrc as Mapbox Source "places"
    participant FavSrc as Mapbox Source "favorites"

    User->>App: Route bootstraps shell
    App->>Auth: Instantiate + set persistence
    App->>Fav: Instantiate (+ window API, `favorites-ready`)
    Fav-->>Window: Emit `favorites-ready`
    MapCmp->>MapSvc: `init(container)`
    MapSvc->>PlacesSrc: `addSource('places', circular_places.geojson)`
    MapSvc->>FavSrc: `addSource('favorites', empty collection)`
    MapSvc-->>Fav: Event `map:favorites-source-ready`
    MapSvc-->>MapCmp: `onReady()` (style+places loaded)
    MapCmp->>Places: `setAllFeatures(queryRenderedFeatures)`
    MapCmp->>Places: `buildIndex(fetch circular_places.geojson)`
    Places-->>MapCmp: `filteredFeatures$` (dedupe base + fav)
    Fav->>Auth: subscribe to `user$`
    Auth-->>Fav: cached/persistent user emitted
    Fav->>Firestore: `collectionData()` listener
    Firestore-->>Fav: favourites snapshot
    Fav->>FavSrc: `pushToMapSource()` (favorites drawn)
    Fav-->>MapCmp: `favorites:update` (heart refresh + favorite keys)
    MapCmp->>MapSvc: `setFavoritesVisibility(favoritesVisible)`
    MapSvc->>PlacesSrc: `setFilter()` favorites-only if categories off & toggle on
    MapSvc->>PlacesSrc: `setPaintProperty()` paint favorites red via `PLACE_KEY`
```
