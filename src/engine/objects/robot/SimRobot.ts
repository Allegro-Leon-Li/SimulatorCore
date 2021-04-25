import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { SimObject } from "../SimObject";
import { SimRobotDrivetrain } from "./SimRobotDrivetrain";
import {
  World,
  Vec2,
  Box,
  BodyDef,
  FixtureDef,
  PrismaticJoint,
} from "planck-js";
import {
  BasicSensorSpec,
  ComplexSensorSpec,
  IRobotSpec,
  isComplexSpec,
} from "../../specs/RobotSpecs";
import { IBaseFixtureUserData } from "../../specs/UserDataSpecs";
import { BasicSensorManager } from "./sensors/BasicSensorManager";
import { ComplexSensorManager } from "./sensors/ComplexSensorManager";
import { MechanismManager } from "./mechanisms/MechanismManager";
import { EventRegistry } from "../../EventRegistry";
import { EntityCategory, EntityMask } from "./RobotCollisionConstants";

const ROBOT_DEFAULT_COLOR = 0x00ff00;

/**
 * Class representing a controllable simulated robot
 *
 * This class should NEVER be instantiated outside of the Sim3D environment.
 * These objects are generated by the simulator infrastructure automatically.
 *
 * To interact with a simulated robot, use the `addRobot()` method on {@link Sim3D}
 * and use the {@link RobotHandle} that it returns.
 */
export class SimRobot extends SimObject {
  private _bodySpecs: BodyDef;
  private _fixtureSpecs: FixtureDef;

  private _drivetrain: SimRobotDrivetrain;
  private _basicSensors: BasicSensorManager;
  private _complexSensors: ComplexSensorManager;
  private _mechanisms: MechanismManager;

  private _meshLoader: GLTFLoader | undefined;
  private _usingCustomMesh = false;

  private _debug_io: boolean = false;

  constructor(spec: IRobotSpec) {
    super("SimRobot");

    if (!spec.customMesh) {
      const color =
        spec.baseColor !== undefined ? spec.baseColor : ROBOT_DEFAULT_COLOR;
      const bodyGeom = new THREE.BoxGeometry(
        spec.dimensions.x,
        spec.dimensions.y,
        spec.dimensions.z
      );
      const bodyMaterial = new THREE.MeshStandardMaterial({ color });
      const bodyMesh = new THREE.Mesh(bodyGeom, bodyMaterial);

      this._mesh = bodyMesh;
    } else {
      this._usingCustomMesh = true;
      // Set up the base mesh as a parent
      this._mesh = new THREE.Mesh();

      // TODO Longer term:
      // We should generalize the mesh loading. Potential ideas include
      // a SimCustomMeshObject that extends SimObject that knows how to
      // load meshes, and SimRobot can extend from that.
      // We might also need to slightly rework how adding a mesh to the
      // scene works, since with mesh loading, it's async. Additionally
      // if our physics geometries depend on mesh information, then that
      // will need to get deferred as well.

      // Set up the loader
      this._meshLoader = new GLTFLoader();
      this._meshLoader.load(
        spec.customMesh.filePath,
        (gltf) => {
          const loadedMesh: THREE.Group = gltf.scene;

          // Translate, Scale, rotate
          if (spec.customMesh.translation) {
            loadedMesh.position.x = spec.customMesh.translation.x;
            loadedMesh.position.y = spec.customMesh.translation.y;
            loadedMesh.position.z = spec.customMesh.translation.z;
          }
          if (spec.customMesh.scale) {
            loadedMesh.scale.x = spec.customMesh.scale.x;
            loadedMesh.scale.y = spec.customMesh.scale.y;
            loadedMesh.scale.z = spec.customMesh.scale.z;
          }
          if (spec.customMesh.rotation) {
            loadedMesh.rotation.x = spec.customMesh.rotation.x;
            loadedMesh.rotation.y = spec.customMesh.rotation.y;
            loadedMesh.rotation.z = spec.customMesh.rotation.z;
          }
          this._mesh.add(gltf.scene);
        },
        undefined,
        (err) => {
          console.error(err);
        }
      );
    }

    const bodyPos: Vec2 = new Vec2(0, 0);
    if (spec.initialPosition) {
      bodyPos.x = spec.initialPosition.x;
      bodyPos.y = spec.initialPosition.y;
    }

    this._bodySpecs = {
      type: "dynamic",
      position: bodyPos,
      angle: 0,
      linearDamping: 0.5,
      bullet: true,
      angularDamping: 0.3,
    };

    const userData: IBaseFixtureUserData = {
      selfGuid: this.guid,
      type: "robot",
    };

    this._fixtureSpecs = {
      shape: new Box(spec.dimensions.x / 2, spec.dimensions.z / 2),
      density: 1,
      isSensor: false,
      friction: 0.3,
      restitution: 0.4,
      userData: userData,
      filterCategoryBits: EntityCategory.ROBOT_PART,
      filterMaskBits: EntityMask.ROBOT_PART,
    };

    // Create managers
    this._basicSensors = new BasicSensorManager(spec, this.guid);
    this._mechanisms = new MechanismManager(spec, this.guid, this);
    this._drivetrain = new SimRobotDrivetrain(spec, this.guid);

    // Configure Mechanisms
    // Add the created sensors as children
    this._mechanisms.mechanisms.forEach((mechanism) => {
      this.addChild(mechanism);

      if (!this._usingCustomMesh && mechanism.mesh) {
        mechanism.mesh.translateY(-this._drivetrain.yOffset);
      }
    });

    // Mechanism sensors must be added before the other sensors are configured.
    // Mechanisms may add their own sensor specs to the robot
    this._mechanisms.getSensorSpecs().forEach((sensorSpec) => {
      if (isComplexSpec(sensorSpec)) {
        this._complexSensors.addSensor(
          sensorSpec as ComplexSensorSpec,
          spec,
          this.guid
        );
      } else {
        this._basicSensors.addSensor(
          sensorSpec as BasicSensorSpec,
          spec,
          this.guid
        );
      }
    });

    // Configure the drivetrain
    // Add the created wheels as children
    this._drivetrain.wheelObjects.forEach((wheel) => {
      this.addChild(wheel);
    });

    // Configure Basic Sensors
    // Add the created sensors as children
    this._basicSensors.sensors.forEach((sensor) => {
      this.addChild(sensor);

      if (!this._usingCustomMesh && sensor.mesh) {
        sensor.mesh.translateY(-this._drivetrain.yOffset);
      }
    });

    // Configure Complex Sensors
    this._complexSensors = new ComplexSensorManager(spec, this.guid);

    // Add the created sensors as children
    this._complexSensors.sensors.forEach((sensor) => {
      this.addChild(sensor);

      if (!this._usingCustomMesh && sensor.mesh) {
        sensor.mesh.translateY(-this._drivetrain.yOffset);
      }
    });

    if (!this._usingCustomMesh) {
      // Adjust our base mesh up
      this._mesh.translateY(-this._drivetrain.yOffset);
    }
  }

  update(ms: number): void {
    // This will let the drivetrain update motor forces
    this._drivetrain.update();

    this._children.forEach((childObj) => {
      childObj.update(ms);
    });

    // Update the mesh
    const bodyCenter = this._body.getWorldCenter();
    this._mesh.position.x = bodyCenter.x;
    this._mesh.position.z = bodyCenter.y;

    this._mesh.rotation.y = -this._body.getAngle();
  }

  configureFixtureLinks(world: World): void {
    this._drivetrain.wheelObjects.forEach((wheel) => {
      world.createJoint(
        new PrismaticJoint(
          {
            enableLimit: true,
            lowerTranslation: 0,
            upperTranslation: 0,
          },
          this._body,
          wheel.body,
          wheel.body.getWorldCenter(),
          new Vec2(1, 0)
        )
      );
    });

    // Configure the basic sensors
    this._basicSensors.sensors.forEach((sensor) => {
      if (!sensor.body) {
        return;
      }
      world.createJoint(
        new PrismaticJoint(
          {
            enableLimit: true,
            lowerTranslation: 0,
            upperTranslation: 0,
          },
          this._body,
          sensor.body,
          sensor.body.getWorldCenter(),
          new Vec2(1, 0)
        )
      );
    });

    // Configure the complex sensors
    this._complexSensors.sensors.forEach((sensor) => {
      if (!sensor.body) {
        return;
      }
      world.createJoint(
        new PrismaticJoint(
          {
            enableLimit: true,
            lowerTranslation: 0,
            upperTranslation: 0,
          },
          this._body,
          sensor.body,
          sensor.body.getWorldCenter(),
          new Vec2(1, 0)
        )
      );
    });

    // Configure the mechanisms
    this._mechanisms.mechanisms.forEach((mechanism) => {
      world.createJoint(
        new PrismaticJoint(
          {
            enableLimit: true,
            lowerTranslation: 0,
            upperTranslation: 0,
          },
          this._body,
          mechanism.body,
          mechanism.body.getWorldCenter(),
          new Vec2(1, 0)
        )
      );
      mechanism.configureFixtureLinks(world);
    });
  }

  registerWithEventSystem(eventRegistry: EventRegistry): void {
    this._basicSensors.registerWithEventSystem(this.guid, eventRegistry);
    this._complexSensors.registerWithEventSystem(this.guid, eventRegistry);
    this._mechanisms.registerWithEventSystem(this.guid, eventRegistry);
  }

  // External facing API
  setMotorPower(channel: number, value: number): void {
    this._drivetrain.setMotorPower(channel, value);
  }

  getDigitalInput(channel: number): boolean {
    return this._basicSensors.getDigitalInput(channel);
  }

  getAnalogInput(channel: number): number {
    let value = this._basicSensors.getAnalogInput(channel);

    if (this._debug_io) {
      console.debug("getAnalogInput", channel, value);
    }

    return value;
  }

  setDigitalOutput(channel: number, value: boolean): void {
    // currently the only place inputs can go is mechanisms (outside of motor control)
    this._mechanisms.setDigitalOutput(channel, value);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getComplexSensorValue(channel: number, sensorType: string): any {
    return this._complexSensors.getSensorInput(channel, sensorType);
  }

  getBodySpecs(): BodyDef {
    return this._bodySpecs;
  }

  getFixtureDef(): FixtureDef {
    return this._fixtureSpecs;
  }
}
