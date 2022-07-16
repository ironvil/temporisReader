import FileLoader from "./FileLoader";
import FileParser from "../file-parser/FileParser";
import FileParserImpl from "../file-parser/FileParserImpl";

export default class FileLoaderImpl implements FileLoader {
  loadFile(path: string, callback: (fileParse: FileParser) => void): void {}
}
