// [SPEC-6] MIDI layer — thin abstraction over the Web MIDI API.
//
// Input: enumerate ports, detect the nanoKONTROL2 by name, react to hot-plug
// ([SPEC-14.5]), and forward raw messages to subscribers (device name + bytes)
// for Mapping to interpret ([SPEC-6.2]). Output: send bytes to a device by name
// for LED feedback ([SPEC-6.4]). Device identity is the port name, which resolves
// CC collisions between controllers ([SPEC-6.5]).

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  direction: 'input' | 'output';
  state: 'connected' | 'disconnected';
}

export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

/** A raw MIDI message tagged with its source device name. */
export interface MidiMessage {
  deviceName: string;
  status: number;
  data1: number;
  data2: number;
}

/** Substring used to recognize the Korg nanoKONTROL2 among the ports. [SPEC-6.1] */
const NANOKONTROL2_MATCH = /nanokontrol2/i;

type PortsListener = (ports: MidiPortInfo[]) => void;
type MessageListener = (message: MidiMessage) => void;

export class MidiService {
  private access: MIDIAccess | null = null;
  private status: MidiStatus = 'idle';
  private listeners = new Set<PortsListener>();
  private messageListeners = new Set<MessageListener>();
  private boundInputs = new Set<string>();

  get currentStatus(): MidiStatus {
    return this.status;
  }

  /** True if the browser exposes the Web MIDI API. [SPEC-14.1] */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  /** Request MIDI access (with sysex, needed later for LED feedback [SPEC-6.4]). */
  async requestAccess(): Promise<void> {
    if (!MidiService.isSupported()) {
      this.status = 'unsupported';
      throw new Error('Web MIDI API non disponible (utiliser Chrome ou Edge).');
    }

    this.status = 'requesting';
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (err) {
      this.status = 'denied';
      // Never swallow silently. [SPEC-14.3]
      throw new Error(`Accès MIDI refusé: ${(err as Error).message}`, { cause: err });
    }

    this.status = 'ready';
    // Hot-plug handling. [SPEC-14.5]
    this.access.onstatechange = () => {
      this.bindInputs();
      this.emit();
    };
    this.bindInputs();
    this.emit();
  }

  /** Attach a message handler to every input port (idempotent per port). */
  private bindInputs(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (this.boundInputs.has(input.id)) continue;
      this.boundInputs.add(input.id);
      const deviceName = input.name ?? 'unknown';
      input.onmidimessage = (event: MIDIMessageEvent) => {
        const data = event.data;
        if (!data || data.length < 3) return;
        const message: MidiMessage = {
          deviceName,
          status: data[0],
          data1: data[1],
          data2: data[2],
        };
        for (const listener of this.messageListeners) listener(message);
      };
    }
  }

  /** Subscribe to raw MIDI input messages; returns an unsubscribe function. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /**
   * Send raw bytes to the first connected output whose name matches (substring,
   * case-insensitive). Used for LED feedback. [SPEC-6.4]. Returns true if sent.
   */
  send(deviceMatch: string, bytes: number[]): boolean {
    if (!this.access) return false;
    const lower = deviceMatch.toLowerCase();
    for (const output of this.access.outputs.values()) {
      if (output.state === 'connected' && (output.name ?? '').toLowerCase().includes(lower)) {
        output.send(bytes);
        return true;
      }
    }
    return false;
  }

  /** Snapshot of every known port. */
  listPorts(): MidiPortInfo[] {
    if (!this.access) return [];
    const ports: MidiPortInfo[] = [];
    for (const input of this.access.inputs.values()) {
      ports.push(toPortInfo(input, 'input'));
    }
    for (const output of this.access.outputs.values()) {
      ports.push(toPortInfo(output, 'output'));
    }
    return ports;
  }

  /** True when a connected nanoKONTROL2 input is present. [SPEC-6.1] */
  hasNanoKontrol2(): boolean {
    return this.listPorts().some(
      (p) => p.state === 'connected' && NANOKONTROL2_MATCH.test(p.name),
    );
  }

  /** Subscribe to port-list changes; returns an unsubscribe function. */
  onPortsChanged(listener: PortsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const ports = this.listPorts();
    for (const listener of this.listeners) listener(ports);
  }
}

function toPortInfo(port: MIDIPort, direction: 'input' | 'output'): MidiPortInfo {
  return {
    id: port.id,
    name: port.name ?? 'unknown',
    manufacturer: port.manufacturer ?? '',
    direction,
    state: port.state === 'connected' ? 'connected' : 'disconnected',
  };
}

export const midi = new MidiService();
