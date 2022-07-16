import {BookHandler, Location, PageSize} from "./BookHandler";
import FileLoader from "../file-loader/FileLoader";
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

  getPage(location: Location, pageSize: PageSize): string[] | false {
    if (this.fileParser === undefined) {
      return false;
    }
    return this.fileParser.getParagraph(0).text.split(" ");
  }

  getPreviousPageLocation(location: Location, pageSize: PageSize): Location {
    return {paragraph: 1, placeInParagraph: 1};
  }

  loadFile(file: string, callBack?: (wasSuccessful: boolean) => void): void {
    this.fileLoader.loadFile(file, fileParser => {
      if (callBack) callBack(true);
      return (this.fileParser = fileParser);
    });
  }
}
