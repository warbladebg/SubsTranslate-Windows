export interface VideoTrack {
  index: number;
  codecName: string;
  codecLongName?: string;
  codecType: "video";
}

export interface OtherMediaStream {
  index: number;
  codecName: string;
  codecType: string;
}
