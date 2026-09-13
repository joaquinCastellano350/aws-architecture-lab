export function executionArnFor(stateMachineArn: string, executionName: string): string {
  const marker = ":stateMachine:";
  const markerIndex = stateMachineArn.indexOf(marker);
  const resource = stateMachineArn.slice(markerIndex + marker.length);
  const stateMachineName = resource.split(":")[0];
  if (markerIndex < 0 || stateMachineName === undefined || stateMachineName.length === 0) {
    throw new Error("ARN is not a Step Functions state machine ARN");
  }
  return `${stateMachineArn.slice(0, markerIndex)}:execution:${stateMachineName}:${executionName}`;
}
