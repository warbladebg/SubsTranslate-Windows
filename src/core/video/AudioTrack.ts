export interface AudioTrack {
  index: number;
  codecName: string;
  codecLongName?: string;
  codecType: "audio";
  language: string;
  title: string;
  channels?: number;
  channelLayout?: string;
  sampleRate?: number;
  bitRate?: number;
}
