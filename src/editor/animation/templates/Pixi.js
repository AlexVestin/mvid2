

import WebGLManager from '../WebGLManager'

export default class Manager extends WebGLManager {

    setUpScene() {
        const scene = this.addSceneFromText("pixi");
        scene.addItemFromText("JSNation");
    }
}