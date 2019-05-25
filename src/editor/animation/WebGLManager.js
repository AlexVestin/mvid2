import * as THREE from "three";
import AttribItem from "./items/ortho/Attribution";
import CanvasScene from "./scenes/CanvasScene";
import OrthographicScene from "./scenes/OrthographicScene";
import PerspectiveScene from "./scenes/PerspectiveScene";
import PostProcessing from "./postprocessing/postprocessing";
import * as FileSaver from "file-saver";
import serialize from './Serialize'
import { base, app, storage } from 'backend/firebase'
import PointAutomation from './automation/PointAutomation'
import InputAutomation from './automation/InputAutomation'
import ImpactAutomation from './automation/AudioReactiveAutomation'
import uuid from 'uuid/v4'
import { takeScreenShot } from 'editor/util/FlipImage'

export default class WebGLManager {
    constructor(parent) {
        
        // Set up for headless testing;
        if(parent) {
            this.gui = parent.gui;
            this.canvasMountRef = parent.gui.canvasMountRef;
            this.modalRef = parent.gui.modalRef;
            this.parent = parent;
            this.setUpControls();
        }
        
        // Project settings
        this.inFullScreen = false;
        this.clearColor = "#000000";
        this.clearAlpha = 1.0;
        this.postprocessingEnabled = false;
        this.fftSize = 16384;

        // Project file settings
        this.__id = uuid();
        this.__owner = this.__id;
        this.__projectName  = "ProjectName";
        this.__lastEdited = new Date().toString();
        this.availablePublic = false;

        // Redraw animations settings
        this.__lastTime = 0;
        this.__lastAudioData = {frequencyData: new Float32Array(this.fftSize/2), timeData: new Float32Array(this.fftSize)};

        // Scenes
        this.scenes = [];
        this.audio = null;
    }

    setUpControls() {
        document.body.addEventListener("keyup", e => {
            if (e.keyCode === 70) {
                if (!this.inFullScreen) {
                    this.fullscreen(this.canvasMountRef);
                }else {
                    try {
                        this.exitFullscreen()
                    }catch(err) {
                        console.log("Error exiting fullscreen");
                    }
                }

                this.inFullScreen = !this.inFullScreen;
            }
        });
    }
    addAutomation = (template) => {
        let auto  = {};
        switch(template.type) {
            case "point":
            auto =  new PointAutomation(this.gui);
            break;
            case "math":
            auto =  new InputAutomation(this.gui);
            break;
            case "audio":
            auto =  new ImpactAutomation(this.gui);
            break;
        default:
            alert("Automation type not found");
        }
        auto.__id = template.__id;
        auto.__setUpValues(template);
        this.gui.getRoot().__automations[auto.__id] = auto;
    }

    loadProject = (json) => {
        while(this.scenes.length > 0) {
            this.scenes[0].removeMe();
        }
        
        if(this.renderer) {
            this.renderer.dispose();
        }

        this.gui.getRoot().__automations = [];

        const proj = JSON.parse(json.projectSrc);

        this.__ownerId = json.owner;
        this.__online = json.online;
        Object.assign(this, proj.settings);
        this.settingsFolder.updateDisplay();
        proj.automations.forEach(auto => {
            this.addAutomation(auto);
        })  

        proj.scenes.forEach(scene => {     
            if(scene.__settings.isScene) {
                const s = this.addSceneFromText(scene.__settings.type || scene.__settings.TYPE);
                s.undoCameraMovement(scene.camera);
                s.controls.enabled = scene.controlsEnabled; 
                s.__automations = scene.__automations;
                if(scene.__controllers)
                    s.__setControllerValues(scene.__controllers.controllers);
                s.addItems(scene.__items || scene.items);
                s.updateSettings();
                Object.assign(s.pass, scene.__passSettings);
            }else {
                const e = this.postProcessing.addEffectPass(scene.__settings.type || scene.__settings.TYPE);
                e.__setControllerValues(scene.controllers);
            }
        })

        if(this.audio){
            this.setFFTSize(this.fftSize);
        }
    }

    loadProjectFromFile = () => {
        this.gui.getRoot().modalRef.toggleModal(16).then(file => {
            if(file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const json = JSON.parse(e.target.result);
                    this.loadProject(json);    
                }
                reader.readAsText(file);
            }
        })
    }

    serializeProject = () => {
        const projFile = {
            scenes: [],
            settings: {}
        };
        projFile.settings = serialize(this);
        projFile.automations = this.gui.getAutomations().map(auto => auto.__serialize());
        
        this.scenes.forEach( (scene, i) => {
            projFile.scenes.push(scene.__serialize())
        })
        return projFile;
    }

    saveProjectToFile = () => {
        const projFile = this.serializeProject();
        const blob = new Blob([JSON.stringify(projFile)], { type: 'application/json' });
        FileSaver.saveAs(blob, this.__projectName + ".json");
    }

    saveProjectToProfile = () => {
        const projFile = this.serializeProject();
        const cu = app.auth().currentUser; 
        if(cu) {

            if(cu.uid !== this.__owner) {
                this.__id = uuid();
                this.__owner = cu.uid;
            }

            const myId = app.auth().currentUser.uid;
            const ref = base.collection("users").doc(myId).collection("projects").doc(this.__id);
            const p1 = ref.set({
                lastEdited: new Date().toString(),
                name: this.__projectName,
                id: this.__id
            });

            const allRef = base.collection("projects").doc(this.__id);


            const p2 = allRef.set({
                projectSrc: JSON.stringify(projFile),
                width: this.width,
                height: this.height,
                name: this.__projectName,
                public: this.availablePublic,
                owner: myId,
                id: this.__id
            });
            let p3;
            if(!this.__online) {
                this.redoUpdate();
                const blob = takeScreenShot(this.canvas);
                p3 = storage.ref().child(this.__id).put(blob)
            }
            

            Promise.all([p1, p2, p3]).then(() => {
                alert("Saved to profile");
                window.history.pushState({}, null, "/editor?project=" + this.__id);
                this.__online = true;
                allRef.update({online: true});
            })

        }else {
            alert("Log in to save to profile")
        }
        console.log(projFile);
    }

    setUpAttrib() {
        // Set up scene for attribution text
        this.attribScene = new THREE.Scene();
        this.attribCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        this.attribCamera.position.z = 1;
        this.attribItem = new AttribItem(this.width, this.height);
        this.attribScene.add(this.attribItem.mesh);
        this.drawAttribution = false;
    }

    removeScene = args => {
        const { scene } = args;
        try {
            this.layersFolder.removeFolder(scene.folder);
            this.layersFolder.__folders[scene.__id] =  undefined;
            delete this.layersFolder.__folders[scene.__id];
        }catch(err) {
            console.log("Scene folder not removed correctly")
        }

        const index = this.scenes.findIndex(e => e === scene);
        this.scenes.splice(index, 1);
        this.postProcessing.remove(scene, index);
    };



    moveScene = args => {
        let { up, scene } = args;

        const folder = scene.folder.domElement.parentElement;
        const list = folder.parentElement;
        const ch = Array.prototype.slice.call(list.children);
        
        // nr items in the gui before the layers 
        const ni = 2;
        const index = ch.indexOf(folder) - ni;
        if (up && index > 0 && index !== ch.length - ni) {
            list.insertBefore(list.children[index + ni], list.children[index + ni - 1]);
            this.scenes.splice(index, 1);
            this.scenes.splice(index - 1, 0, scene);
            this.postProcessing.move(index, index - 1, scene);
        }

        if (!up && index < ch.length - 1 - ni) {
            list.insertBefore(list.children[index + ni + 1], list.children[index + ni]);
            this.scenes.splice(index, 1);
            this.scenes.splice(index + 1, 0, scene);
            this.postProcessing.move(index, index + 1, scene);
        }
    };

    addSceneFromText = sceneName => {
        const sceneTypes = {
            canvas: CanvasScene,
            ortho: OrthographicScene,
            perspective: PerspectiveScene,
        }
        let scene;
        if(!(sceneName in sceneTypes)) {
            this.postProcessing.addEffect(sceneName);
            return
        } else {
            scene = new sceneTypes[sceneName](
                this.layersFolder,
                this.resolution,
                this.removeScene,
                this.moveScene
            )
        }
        
        this.postProcessing.addRenderPass(scene);
        this.scenes.push(scene);
        scene.setUpPassConfigs();

        return scene;
    };

    serialize = () => {
        const settings = {};
        settings.clearColor = this.clearColor;

    }

    addScene = () => {
        this.modalRef.toggleModal(8).then(sceneName => {
            if (sceneName) {
                this.addSceneFromText(sceneName);
            }
        });
    };

    init = (resolution, setUpFolders = true) => {
        this.resolution = resolution;
        this.width = resolution.width;
        this.height = resolution.height;
        this.aspect = this.width / this.height;
        this.setUpAttrib();

        if (setUpFolders) {
            this.layersFolder = this.gui.__folders["Layers"];
            this.layersFolder.add(this, "addScene").name("Add layer");
        }
        this.canvas = this.canvasMountRef;
        this.setUpRenderers(setUpFolders);
        this.setUpScene();
    };

    setUpScene() {
        
    }

    refresh = ref => {
        this.canvasMountRef = ref;
        this.canvas = ref;
        this.setUpRenderer();
    };

    getAllItems = () => {
        const items = [];
        this.scenes.forEach(scene => {
            if(scene.isScene) {
                scene.items.forEach(item => {
                    items.push(item.__attribution);
                });
            }
            
        });
        return items;
    };

    play = (t) =>  {
        this.scenes.forEach(scene => scene.play(t));
    }

    prepareEncoding = () => {
        this.scenes.forEach(scene => {
            if(scene.isScene) {
                scene.items.forEach(item => {
                    item.__isEncoding = true;
                })
            } 
            
        })
    }

    seekTime = (t) => {
        this.scenes.forEach(scene => scene.seekTime(t));
    }


    setClear = () => {
        this.renderer.setClearColor(this.clearColor);
        this.renderer.setClearAlpha(this.clearAlpha);
    };

    setAudio = audio => {
        this.audio = audio;
        this.setFFTSize(this.fftSize);
    };

    setFFTSize = size => {
        this.audio.setFFTSize(size);
        this.gui.__folders["Audio"].updateDisplay();
    };

    setTime = time => {};

    updateAttribution = () => {
        const items = this.getAllItems();
        const names = ["Visuals by:"];
        items.forEach(item => {
            item.authors.forEach(author => {
                if (names.indexOf(author.name) < 0) {
                    names.push(author.name);
                }
            });
        });

        this.attribItem.setText(names, 0.75, -0.6);
    };

    setUpRenderer() {
        const supportsWebGL = ( function () {
            try {
                return !! window.WebGLRenderingContext && !! document.createElement( 'canvas' ).getContext( 'experimental-webgl' );
            } catch( e ) {
                return false;
            }
        } )();

        if(supportsWebGL) {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                canvas: this.canvas
            });
            this.renderer.autoClear = false;
            this.renderer.mock = false;
            this.renderer.setSize(this.width, this.height);
            this.setClear();
        }else {
            // TODO Error message
            this.renderer = {};
            this.renderer.getDrawingBufferSize = () => { return  {width: 1080, height: 720} }
            this.renderer.mock = true;
            this.renderer.clear = () => {};
            this.renderer.clearDepth = () => {};
            this.renderer.render = () => {};
            this.postProcessing = {};
        }

        this.postProcessing = new PostProcessing(this.width, this.height, {
            renderer: this.renderer,
            gui: this.layersFolder,
            addEffect: this.addNewEffect,
            moveItem: this.moveScene,
            removeItem: this.removeScene
        });
    }

    addNewEffect  = (effect) => {
        this.scenes.push(effect);
    }

    setUpRenderers = (setUpFolders = true) => {
        this.setUpRenderer();
          
        if (setUpFolders) {
            const frequencies = [1,5,30,60];
            this.settingsFolder = this.gui.__folders["Settings"];
            this.settingsFolder
                .add(this.gui, "__automationConfigUpdateFrequency", frequencies)
                .name("configUpdateFrequency");
            const rs = this.settingsFolder.addFolder("Render settings");
            
            rs.addColor(this, "clearColor")
                .onChange(this.setClear);
            
            rs.add(this, "clearAlpha", 0, 1, 0.001)
                .onChange(this.setClear)
                .disableAutomations();
            rs.add(this, "drawAttribution")
                .onChange(this.updateAttribution);
            this.gui.__folders["Layers"].add(this, "postprocessingEnabled");

            const cs = this.settingsFolder.addFolder("Camera and control settings");
            cs.add(this, "enableAllControls");
            cs.add(this, "disableAllControls");
            cs.add(this, "resetAllCameras");
            const ps = this.settingsFolder.addFolder("Project settings");
            ps.add(this, "__projectName").name("Project name");
            ps.add(this, "availablePublic").name("Project available to public");
            ps.add(this, "loadProjectFromFile");
            ps.add(this, "createThumbnail");
            ps.add(this, "saveProjectToFile");
            ps.add(this, "saveProjectToProfile");
        }
    };

    createThumbnail = () => {
        this.gui.getRoot().modalRef.toggleModal(19, true, this);
    }

    resetAllCameras = () => {
        this.scenes.forEach(scene => {
            if(scene.isScene)
                scene.resetCamera();
        });
    };

    disableAllControls = () => {
        this.scenes.forEach(scene => {
            if(scene.isScene) {
                scene.controls.enabled = false;
                scene.cameraFolder.updateDisplay();
            }
        });
    };

    enableAllControls = () => {
        this.scenes.forEach(scene => {
            if(scene.isScene) {
                scene.controls.enabled = true;
                scene.cameraFolder.updateDisplay();
            }
           
        });
    };

    exitFullscreen(canvas) {
        if(document.fullscreenElement || 
            document.webkitFullscreenElement || 
            document.mozFullScreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        }
        
    }
    fullscreen(canvas) {
        if (canvas.RequestFullScreen) {
            canvas.RequestFullScreen();
        } else if (canvas.webkitRequestFullScreen) {
            canvas.webkitRequestFullScreen();
        } else if (canvas.mozRequestFullScreen) {
            canvas.mozRequestFullScreen();
        } else if (canvas.msRequestFullscreen) {
            canvas.msRequestFullscreen();
        } else {
            alert("This browser doesn't supporter fullscreen");
        }
    }

    readPixels = () => {
        const { width, height } = this;
        const glContext = this.renderer.getContext();
        const pixels = new Uint8Array(width * height * 4);
        glContext.readPixels(
            0,
            0,
            width,
            height,
            glContext.RGBA,
            glContext.UNSIGNED_BYTE,
            pixels
        );
        return pixels;
    };

    stop = () => {
        this.__lastTime = 0;
        this.__lastAudioData = {frequencyData: [], timeData: []};
        this.scenes.forEach(scene => {
            scene.stop();
        });
        this.renderer.clear();
    };

    redoUpdate = () => {
        this.update(this.__lastTime, this.__lastAudioData, false);
    }

    update = (time, audioData, shouldIncrement) => {
        if (!this.postprocessingEnabled) {
            this.renderer.clear();
            this.scenes.forEach(scene => {
                if (scene.isScene) {
                    scene.update(time, audioData, shouldIncrement);
                    this.renderer.render(scene.scene, scene.camera);
                    this.renderer.clearDepth();
                }
            });
        } else {
            this.postProcessing.update(time, audioData, shouldIncrement);
            this.postProcessing.render();
        }

        if (this.drawAttribution) {
            this.renderer.render(this.attribScene, this.attribCamera);
        }

        this.__lastTime = time;
        this.__lastAudioData = audioData;
    };
}
