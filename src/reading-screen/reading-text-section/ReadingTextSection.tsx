import React from "react";
import {Text} from "react-native";
import styled from "styled-components/native";

const BodyText = styled.Text`
  font-size: 18px;
  color: white;
  line-height: 71.9px;
`;

const Background = styled.View`
  padding: 0% 45%;
  width: 100%;
  height: 100%;
`;

type ReadingTextSectionProps = {width: number; height: number};
function ReadingTextSection(props: ReadingTextSectionProps) {
  const {width, height} = props;

  return (
    <Background>
      <Text>
        <BodyText>
          {"MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"}
        </BodyText>
        <BodyText>{height}</BodyText>
      </Text>
      <BodyText>A new line</BodyText>
    </Background>
  );
}

export default React.memo(ReadingTextSection);
