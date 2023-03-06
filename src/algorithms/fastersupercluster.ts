/**
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AbstractAlgorithm, AlgorithmInput, AlgorithmOutput } from "./core";
import { SuperClusterOptions } from "./supercluster";
import SuperCluster, { ClusterFeature } from "supercluster";

import { Cluster, ClusterOptions } from "../cluster";
import { deepEqual, shallowEqual } from "fast-equals";

type BoundingBox = [number, number, number, number];

export interface SuperClusterClusterOptions extends ClusterOptions {
  id?: number;
  superCluster: SuperCluster;
}

export class SuperClusterCluster extends Cluster {
  public readonly id?: number;
  protected superCluster: SuperCluster;

  constructor({ id, superCluster, ...options }: SuperClusterClusterOptions) {
    super(options);
    this.id = id;
    this.superCluster = superCluster;
  }

  /**
   * String summary of the cluster for fast comparison.
   */
  public get summary(): string {
    return `${this.position} ${this.count}`;
  }

  /**
   * The next required zoom level for expanding a cluster object on click.
   */
  public get expansionZoom(): number {
    const clusterZoom = this.superCluster.getClusterExpansionZoom(this.id);
    return Math.min(clusterZoom, 20);
  }
}

/**
 * A very fast JavaScript algorithm for geospatial point clustering using KD trees.
 *
 * @see https://www.npmjs.com/package/supercluster for more information on options.
 */
export class FasterSuperClusterAlgorithm extends AbstractAlgorithm {
  protected superCluster: SuperCluster;
  protected markers: google.maps.Marker[];
  protected clusters: SuperClusterCluster[];
  protected state: { zoom: number, boundingBox: BoundingBox };

  constructor({ maxZoom, radius = 60, ...options }: SuperClusterOptions) {
    super({ maxZoom });

    this.superCluster = new SuperCluster({
      maxZoom: this.maxZoom,
      radius,
      ...options,
    });

    this.state = { zoom: null, boundingBox: [-180, -90, 180, 90] };
  }

  public calculate(input: AlgorithmInput): AlgorithmOutput {
    let changed = false;

    if (!deepEqual(input.markers, this.markers)) {
      changed = true;
      // TODO use proxy to avoid copy?
      this.markers = [...input.markers];

      const points = this.markers.map((marker) => {
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [
              marker.getPosition().lng(),
              marker.getPosition().lat(),
            ],
          },
          properties: { marker },
        };
      });

      this.superCluster.load(points);
    }

    const state = {
      zoom: input.map.getZoom(),
      boundingBox: this.getBoundingBox(input.map)
    };

    if (!changed) {
      if (this.state.zoom > this.maxZoom && state.zoom > this.maxZoom) {
        // still beyond maxZoom, no change
      } else {
        changed = changed || !deepEqual(this.state, state);
      }
    }

    this.state = state;

    if (changed) {
      const clusters = this.cluster(input);

      // Shallow-compare cluster points to avoid unnecessary re-renders
      if (clusters && this.clusters) {
        if (shallowEqual(clusters.map(c => c.summary), this.clusters.map(c => c.summary))) {
          changed = false
        }
      }

      this.clusters = clusters;
    }

    return { clusters: this.clusters, changed };
  }

  public cluster({ map }: AlgorithmInput): SuperClusterCluster[] {
    return this.superCluster
      .getClusters(this.getBoundingBox(map), Math.round(map.getZoom()))
      .map(this.transformCluster.bind(this));
  }

  /**
   * Get the bounding box of a map as array of coordinates.
   */
  protected getBoundingBox(map: google.maps.Map): BoundingBox {
    const bounds = map.getBounds().toJSON();
    return [bounds.west, bounds.south, bounds.east, bounds.north];
  }

  protected transformCluster({
    geometry: {
      coordinates: [lng, lat],
    },
    properties: {
      cluster,
      cluster_id: clusterId,
      marker,
    },
  }: ClusterFeature<{ marker: google.maps.Marker }>): Cluster {
    if (cluster) {
      return new SuperClusterCluster({
        id: clusterId,
        markers: this.superCluster
          .getLeaves(clusterId, Infinity)
          .map((leaf) => leaf.properties.marker),
        position: new google.maps.LatLng({ lat, lng }),
        superCluster: this.superCluster,
      });
    } else {
      return new Cluster({
        markers: [marker],
        position: marker.getPosition(),
      });
    }
  }
}
