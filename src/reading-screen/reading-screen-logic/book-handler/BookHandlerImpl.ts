import {BookHandler, Location, PageSize} from "./BookHandler";
import FileLoader from "../fileLoader/FileLoader";
import FileParser from "../file-parser/FileParser";

export default class BookHandlerImpl implements BookHandler {
  private fileLoader: FileLoader;
  private fileParser: FileParser | undefined;

  constructor(fileLoader: FileLoader) {
    this.fileLoader = fileLoader;
  }

  getNextPageLocation(location: Location, pageSize: PageSize): Location {
    return {paragraph: 1, placeInParagraph: 1};
  }

  getPage(location: Location, pageSize: PageSize): string[] {
    // @ts-ignore
    return [this.fileParser.getParagraph(0).text];
  }

  getPreviousPageLocation(location: Location, pageSize: PageSize): Location {
    return {paragraph: 1, placeInParagraph: 1};
  }

  loadFile(file: string): void {
    this.fileLoader.loadFile(
      file,
      fileParser => (this.fileParser = fileParser),
    );
  }
}
