export type Location = {
  paragraph: number;
  placeInParagraph: number;
};

export type PageSize = {charsPerLine: number; numLines: number};

export interface BookHandler {
  loadFile: (file: string, callBack: (wasSuccessful: boolean) => void) => void;
  getPage: (location: Location, pageSize: PageSize) => string[] | false;
  getPreviousPageLocation: (location: Location, pageSize: PageSize) => Location;
  getNextPageLocation: (location: Location, pageSize: PageSize) => Location;
}
