import FileParser from "./FileParser";

export default class FileParserImpl implements FileParser {
  private readonly fileContents: string;

  constructor(fileContents: string) {
    this.fileContents = fileContents;
  }
  getParagraph(index: number): {text: string; status: string} {
    return {status: "", text: this.fileContents};
  }
}
