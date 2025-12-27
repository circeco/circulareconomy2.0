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
