## [CIRCECO.org](https://circeco.org)

A multi-city platform for finding circular ♻︎ places and events.

![circulareconomy](https://circeco.github.io/circulareconomy/assets/img/demo/home_page.jpg)

### Circeco is a platform about circular economy for mapping circular initiative and events at a city-scoped level.
The aim is to highlight and promote the network of existing circular initiative in the city area by making it easily searchable and available to the user. The app also wants to inform about the kind of circular action the user can take in order to have a sustainable alternative to the common consumption model take-make-dispose.

## Technologies

**Angular**  
Single-page app for the landing page, Circular Atlas, events, and account.

**TypeScript / SCSS**  
Application logic and styles. Bootstrap and Font Awesome are used for layout and icons.

**Firebase**  
Authentication, cloud database, and hosting for the live site.

**Mapbox**  
Interactive city map for the Circular Atlas. Place markers follow the circular-action colour palette; saved favourites are highlighted.

**OpenStreetMap**  
Public map data used to help discover circular places.

**Formspree**  
Contact form on the public site.

## UX

User experience (UX) is how it feels to use Circeco to find a circular place or event in a city: whether the path is clear, useful, and low-friction—not only how it looks. This section covers who it is for, what they can do, and how the interface supports that.

The design goal is a sleek, simple interface. Colour is kept to a minimum: black and white, teal/green-blue shades for circularity (and the logo), and red for attention—favourites on the map, and a reminder of environmental urgency. The same palette and type make the brand recognisable across landing, atlas, and events.

A sticky navigation bar keeps Atlas, Events, city, and account always available. The public site is no longer one long page: landing introduces the idea and search, then Atlas and Events are dedicated screens so people can focus on the map or the calendar. The landing title animation still spells out CIRC | ECO without extra copy. Hover on the circular-action cards shows each action’s meaning without crowding the page; a rotating-word line states the six actions. Hover on the logo, nav, and buttons marks what is interactive.

The Circular Atlas is the main task: find an initiative on the map, open its details, and optionally save it. Dots use the taxonomy colour of the place’s action tag; favourites stay red when the user is logged in. Clicking a dot (or a list item) zooms and opens a popup with name, address, and website. The list follows the visible map; filters and search work together with pan and zoom. The city switcher scopes places, events, and the map to the selected city. Hearts and account features appear only when signed in, so browsing stays open and saving stays personal.

## Taxonomy

Places and events are organised by circular actions. Canonical descriptions and colours: [`CIRCULAR_TAXONOMY.md`](CIRCULAR_TAXONOMY.md)

- refuse, reuse, repair, reporpouse, recycle, reduce

## Data & moderation

Places and events are discovered from public sources (e.g. OpenStreetMap for places; web search + feeds for events), held in a review queue, and published only after human approval. Approvals and rejections feed a memory layer so discovery skips duplicates and weak repeats; a monthly report summarizes which signals are working.

Details: [`SCHEDULED_DISCOVERY_LEARNING_PLAN.md`](SCHEDULED_DISCOVERY_LEARNING_PLAN.md), [`LEARNING_V1_SPEC.md`](LEARNING_V1_SPEC.md), [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md).

## Run locally

```bash
cd frontend
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

## Licence and Copyright

Circeco.org holds the copyright for the product idea, content, and code in this repository.

Author **Piero Grilli**
