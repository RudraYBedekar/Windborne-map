# Windborne Technical Documentation

## System Overview

Windborne is an interactive 3D weather visualization platform designed to track global hot air balloon telemetry. The system provides a unified interface for visualizing geospatial data, rendering real-time weather effects, and exploring flight paths on a dynamic 3D globe. It is built to facilitate both casual exploration and detailed data analysis of balloon flight patterns.

## Getting Started

Follow these steps to set up the project locally for development or testing.

### Prerequisites
*   Node.js (v18 or higher)
*   npm, yarn, or pnpm

### Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/yourusername/windborne.git
    cd windborne
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```

3.  **Run Development Server**
    ```bash
    npm run dev
    ```

4.  **Access the Application**
    Open your browser and navigate to `http://localhost:3000`.

## User Guide

How to use the Windborne platform features:

1.  **Explore the Globe**
    *   **Rotate**: Click and drag to rotate the 3D globe.
    *   **Zoom**: Use the scroll wheel to zoom in and out.
    *   **Tilt**: Right-click and drag to change the pitch/tilt of the map.

2.  **Track Balloons**
    *   Look for the **Balloon Icons** scatter across the map.
    *   **Click** on any balloon to select it. This will:
        *   Zoom the camera to the balloon.
        *   Animate the flight path drawing on the map.
        *   Open the **Details Card** with live telemetry (Altitude, Speed) and weather data.

3.  **Search Locations**
    *   Use the search bar at the top center.
    *   Type a city or country name (e.g., "Paris", "Japan").
    *   Select a result to automatically fly the camera to that location.

4.  **View Weather**
    *   Upon loading, a dynamic weather overlay (Rain, Snow, or Wind) will appear briefly.
    *   Real-time weather data for a specific balloon's location is displayed in the Details Card when a balloon is selected.

## Architecture Overview

The application follows a modern, component-based architecture using the **Next.js App Router**.

### High-Level Components

*   **Frontend Client (Next.js/React)**: Handles the UI, state management, and rendering of the application shell.
*   **Map Visualization Layer (MapLibre GL JS)**: A WebGL-powered mapping engine responsible for rendering the 3D globe, terrain, and geospatial vectors (balloons, paths).
*   **Data Services Layer**: Typed TypeScript services that abstract API communication for balloon telemetry and weather data.
*   **Presentation Layer**: Uses Tailwind CSS for a responsive, "glassmorphism" design system that overlays the complex map visualization.

### Architecture Diagram (Conceptual)

```mermaid
graph TD
    Client[Client Browser] --> Next[Next.js App Server]
    Client --> MapLibre[MapLibre GL Context]
    
    subgraph Data Flow
    Next -- Telemetry Data --> API[/api/windborne]
    API --> Client
    Client -- User Search --> Nominatim[OpenStreetMap Nominatim API]
    Client -- Weather Data --> OpenMeteo[Weather API]
    end
    
    subgraph Visualization
    Client --> WeatherFX[WeatherEffects Overlay]
    Client --> Globe[3D Globe Projection]
    Globe -- Renders --> Balloons[Balloon Vectors]
    Globe -- Renders --> Paths[Flight Paths]
    end
```

## Core Features and Implementation Details

### 3D Globe Visualization
The core of Windborne is the `MapComponent`, which initializes a MapLibre instance with `projection: 'globe'`. 
-   **Implementation**: Utilizes `react-map-gl` to bridge React state with the imperative MapLibre API.
-   **Terrain**: Rendering of 3D terrain exaggeration (1.5x) to visualize altitude differences.
-   **Atmosphere**: Custom atmospheric styling to simulate horizon glow and depth.

### Real-Time Weather Effects
Weather visualization is handled by two distinct subsystems:
1.  **Visual Overlay (`WeatherEffects.tsx`)**: A particle system built with CSS animations and React state that renders dynamic rain, snow, or wind effects. These effects are randomized on session start and fade out to reveal the map.
2.  **Data Visualization**: The details card fetches and displays live weather metrics (Temperature, Wind Speed) for the selected location using the `fetchWeather` utility.

### Balloon Tracking and Flight Paths
Balloons are rendered as interactive vector features.
-   **Custom Markers**: SVG Balloon icons are loaded into the map sprite sheet for performant rendering of hundreds of entities.
-   **Pulsing Indicators**: A custom HTML5 Canvas source generates a "pulsing dot" animation at the balloon's current location to attract user attention.
-   **Flight Paths**: When a balloon is selected, the system draws its historical path using a `LineString` feature. 
    -   *Animation*: A `requestAnimationFrame` loop progressively renders the line segment, creating a "drawing" effect from launch to current position over 2.5 seconds.

### Interactive Data Exploration
-   **Selection Logic**: Clicking a balloon triggers a `flyTo` camera animation, zooming into the target while maintaining a 3D pitch.
-   **Details Card**: A glassmorphic UI panel overlays the map, displaying altitude, coordinates, and associated weather data.
-   **Points of Interest (POIs)**: Curated locations (e.g., launch sites) utilize the GeoJSON source to display labeled markers.

### Search and Navigation
-   **Geocoding**: Integrated with the OpenStreetMap Nominatim API.
-   **User Flow**: Users type a query -> System fetches lat/lon -> Map camera performs an essential flight animation to the new bounding box.

## Data Flow (Step-by-Step)

1.  **Initialization**:
    -   The application loads `page.tsx`, mounting the `MapComponent`.
    -   `WeatherEffects.tsx` assesses a random weather type and begins particle animation.

2.  **Data Ingestion**:
    -   `useEffect` hooks trigger `fetchWindBorneData`, ensuring types match the `Balloon` interface.
    -   Data is transformed into Memoized GeoJSON `FeatureCollections` for the map source.

3.  **Rendering**:
    -   MapLibre renders the base dark matter tiles.
    -   Balloon sources are added; the map waits for the SVG icon image `onload` event.

4.  **Interaction**:
    -   **User Click**: Event handler captures the feature ID.
    -   **State Update**: `selectedId` updates, triggering the specific path render and details card visibility.
    -   **Camera Move**: The map view automates a smooth transition to the selected entity.

## Design Goals

-   **Visual Premium**: The interface uses a deep palette (Dark Matter map style, `#020409` backgrounds) with high-contrast neon accents (Cyan/Yellow) to convey a high-tech, dashboard aesthetic.
-   **Performance**: 
    -   Heavy computation (particle effects, map rendering) is offloaded to the GPU via WebGL and CSS transforms.
    -   React `useMemo` is strictly used for GeoJSON generation to prevent re-parsing large datasets on every render.
-   **Discoverability**: Critical data is hidden until interaction (hover/click) to maintain a clean "Blue Marble" view of the globe.

## Future Enhancements

-   **WebSocket Integration**: Replace polling with live WebSocket connections for sub-second telemetry updates.
-   **Historical Playback**: A scrubber UI to replay flight paths over time (e.g., "Last 24 Hours").
-   **Volumetric Clouds**: Upgrade simple particle effects to 3D volumetric cloud layers using Three.js custom layers within MapLibre.
-   **User Accounts**: Save favorite balloons or launch sites.
