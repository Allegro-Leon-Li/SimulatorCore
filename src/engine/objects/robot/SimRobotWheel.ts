import * as THREE from "three";
import { SimObject } from "../SimObject";
import { Vec2, Box, BodyDef, FixtureDef } from "planck-js";
import { IRobotWheelSpec, ISimUserData } from "../../specs/RobotSpecs";
import { Vector3d } from "../../SimTypes";

const DEFAULT_WHEEL_COLOR = 0x000000;
const DEFAULT_WHEEL_THICKNESS = 0.15;

export class SimRobotWheel extends SimObject {
  protected _forceMagnitude = 0;

  private _bodySpecs: BodyDef;
  private _fixtureSpecs: FixtureDef;

  constructor(
    spec: IRobotWheelSpec,
    robotGuid: string,
    wheelPos?: Vector3d,
    shouldRender?: boolean
  ) {
    super("SimWheel");

    const thickness =
      spec.thickness !== undefined ? spec.thickness : DEFAULT_WHEEL_THICKNESS;

    if (shouldRender) {
      const color =
        spec.baseColor !== undefined ? spec.baseColor : DEFAULT_WHEEL_COLOR;

      const wheelGeom = new THREE.CylinderGeometry(
        spec.radius,
        spec.radius,
        thickness
      );
      const wheelMaterial = new THREE.MeshStandardMaterial({ color });
      const wheelMesh = new THREE.Mesh(wheelGeom, wheelMaterial);

      this._mesh = wheelMesh;
    } else {
      // empty mesh
      this._mesh = new THREE.Mesh();
    }

    // rotate Pi/2 around the Z axis to get it vertical
    this._mesh.rotation.z = Math.PI / 2;

    const bodyPos: Vec2 = new Vec2(0, 0);

    if (wheelPos !== undefined) {
      this._mesh.position.x = wheelPos.x;
      this._mesh.position.y = wheelPos.y;
      this._mesh.position.z = wheelPos.z;

      bodyPos.x = wheelPos.x;
      bodyPos.y = wheelPos.z;
    }

    this._bodySpecs = {
      type: "dynamic", // wheels are always dynamic
      position: bodyPos,
      angle: 0, // TODO implement using info provided in spec
      linearDamping: 0.5,
      bullet: true,
      angularDamping: 0.3,
    };

    const userData: ISimUserData = {
      robotGuid,
    };

    this._fixtureSpecs = {
      shape: new Box(thickness / 2, spec.radius),
      density: 1,
      isSensor: false,
      friction: 0.3,
      restitution: 0.4,
      userData: userData,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(ms: number): void {
    // Generate a force based on input
    const forceVector = this._body.getWorldVector(new Vec2(0, -1));
    forceVector.mul(this._forceMagnitude);

    const bodyCenter = this._body.getWorldCenter();

    if (forceVector.lengthSquared() > 0.001) {
      // Apply the force, simulating the wheel pushing against ground friction
      this._body.applyForce(forceVector, bodyCenter, true);
    }

    // Update the mesh
    this._mesh.position.x = bodyCenter.x;
    this._mesh.position.z = bodyCenter.y;

    this._mesh.rotation.y = -this._body.getAngle();
  }

  setForce(force: number): void {
    this._forceMagnitude = force;
  }

  getBodySpecs(): BodyDef {
    return this._bodySpecs;
  }

  getFixtureDef(): FixtureDef {
    return this._fixtureSpecs;
  }
}
