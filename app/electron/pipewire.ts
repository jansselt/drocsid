import { execFileSync } from 'child_process';

export interface AudioApp {
  nodeId: number;
  name: string;
  binary: string;
  streamName: string;
}

interface PwObject {
  id: number;
  type: string;
  info?: {
    props?: Record<string, string | number>;
    direction?: string;
    params?: {
      EnumFormat?: unknown[];
    };
  };
}

/**
 * List all audio applications currently outputting audio via PipeWire.
 * Filters out our own app (drocsid) to prevent feedback loops.
 */
export function listAudioApplications(): AudioApp[] {
  if (process.platform !== 'linux') return [];

  try {
    const raw = execFileSync('pw-dump', [], { encoding: 'utf-8', timeout: 5000 });
    const objects: PwObject[] = JSON.parse(raw);

    const apps: AudioApp[] = [];

    for (const obj of objects) {
      if (obj.type !== 'PipeWire:Interface:Node') continue;

      const props = obj.info?.props;
      if (!props) continue;

      const mediaClass = props['media.class'];
      if (mediaClass !== 'Stream/Output/Audio') continue;

      const appName = String(props['application.name'] || props['node.name'] || 'Unknown');
      const binary = String(props['application.process.binary'] || '');
      const streamName = String(props['media.name'] || '');

      // Filter out our own app
      if (appName.toLowerCase().includes('drocsid') || binary.toLowerCase().includes('drocsid')) {
        continue;
      }

      apps.push({
        nodeId: obj.id,
        name: appName,
        binary,
        streamName,
      });
    }

    return apps;
  } catch (e) {
    console.error('[pipewire] Failed to list audio applications:', e);
    return [];
  }
}

/**
 * Create a PipeWire null-sink (virtual audio device) using pactl.
 * Returns the module ID for later cleanup.
 */
export function createNullSink(sinkName: string): number {
  const output = execFileSync('pactl', [
    'load-module', 'module-null-sink',
    `sink_name=${sinkName}`,
    `sink_properties=device.description=${sinkName}`,
  ], { encoding: 'utf-8', timeout: 5000 });
  return parseInt(output.trim(), 10);
}

/**
 * Destroy a previously created null-sink by module ID.
 */
export function destroyNullSink(moduleId: number): void {
  try {
    execFileSync('pactl', ['unload-module', String(moduleId)], { timeout: 5000 });
  } catch (e) {
    console.error('[pipewire] Failed to destroy null sink:', e);
  }
}

/**
 * Find a PipeWire node by its node.name property.
 * Searches through a pre-fetched pw-dump objects array.
 */
export function findNodeByName(objects: PwObject[], name: string): number | null {
  for (const obj of objects) {
    if (obj.type !== 'PipeWire:Interface:Node') continue;
    const nodeName = obj.info?.props?.['node.name'];
    if (nodeName === name) return obj.id;
  }
  return null;
}

/**
 * Find all ports belonging to a specific node in a given direction.
 */
export function findNodePorts(objects: PwObject[], nodeId: number, direction: 'input' | 'output'): number[] {
  const portDirection = direction === 'input' ? 'in' : 'out';
  const ports: number[] = [];

  for (const obj of objects) {
    if (obj.type !== 'PipeWire:Interface:Port') continue;
    const props = obj.info?.props;
    if (!props) continue;

    const portNodeId = Number(props['node.id']);
    const portDir = props['port.direction'];

    if (portNodeId === nodeId && portDir === portDirection) {
      ports.push(obj.id);
    }
  }

  return ports.sort((a, b) => a - b);
}

/**
 * Link an application's output ports to a null-sink's input ports using pw-link.
 * Returns the number of links created.
 */
export function linkAppToNullSink(objects: PwObject[], targetNodeId: number, sinkNodeId: number): number {
  const outputPorts = findNodePorts(objects, targetNodeId, 'output');
  const inputPorts = findNodePorts(objects, sinkNodeId, 'input');

  let linksCreated = 0;
  const pairs = Math.min(outputPorts.length, inputPorts.length);

  for (let i = 0; i < pairs; i++) {
    try {
      execFileSync('pw-link', [String(outputPorts[i]), String(inputPorts[i])], { timeout: 5000 });
      linksCreated++;
    } catch (e) {
      console.error(`[pipewire] Failed to link port ${outputPorts[i]} -> ${inputPorts[i]}:`, e);
    }
  }

  return linksCreated;
}

/**
 * Get the current pw-dump output as parsed JSON.
 */
export function getPwDump(): PwObject[] {
  const raw = execFileSync('pw-dump', [], { encoding: 'utf-8', timeout: 5000 });
  return JSON.parse(raw);
}
