import React from "react";
import ReadingTextSection from "./reading-text-section/ReadingTextSection";
import {useWindowDimensions} from "react-native";

function ReadingScreen() {
  const {width, height} = useWindowDimensions();
  return <ReadingTextSection width={width} height={height} />;
}

export default React.memo(ReadingScreen);
