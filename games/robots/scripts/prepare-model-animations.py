"""Attach baked runtime animation actions and optional native IK controls.
Run after prepare-model.py and prepare-model-bake.mjs on Automaton-Combat-Rig.blend.
"""
import bpy, os, json
from mathutils import Vector, Quaternion
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE=os.path.join(ROOT,'assets-source')
with open(os.path.join(SOURCE,'combat-animation-library.json'),encoding='utf8') as f: data=json.load(f)
arm=bpy.data.objects['Automaton_Rig']
arm.animation_data_create()
# Keep the supplied reactor editable as a separate rigid skinned piece in the
# authoring file. Its animated offset mirrors runtime core extraction exactly.
reactor=bpy.data.objects.get('Original_Reactor_Skin')
if reactor is None:
    skin=bpy.data.objects['Automaton_Beetle_Skin']
    bpy.ops.object.select_all(action='DESELECT');skin.select_set(True);bpy.context.view_layer.objects.active=skin
    bpy.context.tool_settings.mesh_select_mode=(False,False,True)
    for vertex in skin.data.vertices: vertex.select=False
    for edge in skin.data.edges: edge.select=False
    for polygon in skin.data.polygons: polygon.select=skin.data.materials[polygon.material_index].name.startswith('Automaton_Lenses_Reactor')
    before=set(bpy.data.objects)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT')
    reactor=next(obj for obj in bpy.data.objects if obj not in before);reactor.name='Original_Reactor_Skin'
for component in range(3):
    prop=f'core_extract_{component}';arm[prop]=0.0
    try: reactor.driver_remove('location',component)
    except TypeError: pass
    driver=reactor.driver_add('location',component).driver;driver.type='SCRIPTED';driver.expression='offset'
    variable=driver.variables.new();variable.name='offset';variable.type='SINGLE_PROP';variable.targets[0].id=arm;variable.targets[0].data_path=f'["{prop}"]'
# Signal drivers use the same armature action as the joints, so selecting a
# damaged/critical clip also shows its health and status on the original lamps.
for channel in ['health','status','reactor']:
    material=bpy.data.materials['Automaton_Lenses_'+channel.title()]
    shader=material.node_tree.nodes.get('Principled BSDF')
    for component in range(4):
        prop=f'signal_{channel}_{component}'
        arm[prop]=1.0
        socket=shader.inputs['Emission Color'] if component<3 else shader.inputs['Emission Strength']
        try: socket.driver_remove('default_value',component) if component<3 else socket.driver_remove('default_value')
        except TypeError: pass
        driver=(socket.driver_add('default_value',component) if component<3 else socket.driver_add('default_value')).driver
        driver.type='SCRIPTED';driver.expression='value'
        variable=driver.variables.new();variable.name='value';variable.type='SINGLE_PROP'
        variable.targets[0].id=arm;variable.targets[0].data_path=f'["{prop}"]'
        if component<3:
            base_socket=shader.inputs['Base Color']
            try: base_socket.driver_remove('default_value',component)
            except TypeError: pass
            base_driver=base_socket.driver_add('default_value',component).driver
            base_driver.type='SCRIPTED';base_driver.expression='value * 0.14'
            base_variable=base_driver.variables.new();base_variable.name='value';base_variable.type='SINGLE_PROP'
            base_variable.targets[0].id=arm;base_variable.targets[0].data_path=f'["{prop}"]'
for old in list(bpy.data.actions): bpy.data.actions.remove(old)
for clip in data['clips']:
    action=bpy.data.actions.new('Combat_'+clip['name'].title());action.use_fake_user=True
    arm.animation_data.action=action
    for index,pose in enumerate(clip['frames']):
        for name,d in pose.items():
            bone=arm.pose.bones[name]
            x,y,z,w=d['q'];bone.rotation_mode='QUATERNION';bone.rotation_quaternion=Quaternion((w,x,y,z))
            bone.keyframe_insert('rotation_quaternion',frame=index+1,group=name)
            if 'p' in d:
                bone.location=d['p'];bone.keyframe_insert('location',frame=index+1,group=name)
        for channel,signal in clip.get('signals',[{}]*len(clip['frames']))[index].items():
            for component,value in enumerate([*signal['color'],signal['intensity']]):
                prop=f'signal_{channel}_{component}';arm[prop]=float(value)
                arm.keyframe_insert(data_path=f'["{prop}"]',frame=index+1,group='Signals / '+channel)
        offset=clip.get('extraction',[[0,0,0]]*len(clip['frames']))[index]
        for component,value in enumerate([offset[0],-offset[2],offset[1]]):
            prop=f'core_extract_{component}';arm[prop]=float(value);arm.keyframe_insert(data_path=f'["{prop}"]',frame=index+1,group='Original core extraction')
    action['duration_seconds']=clip['duration'];action['fps']=data['fps'];action['source']='src/robot.js: CCD + combat motion, baked by scripts/prepare-model-bake.mjs'
    action['preview_hp']=clip.get('hp',100)
arm.animation_data.action=None
for bone in arm.pose.bones:
    bone.rotation_quaternion=(1,0,0,0);bone.location=(0,0,0)
for component in range(3): arm[f'core_extract_{component}']=0.0
for channel,signal in data['clips'][0]['signals'][0].items():
    for component,value in enumerate([*signal['color'],signal['intensity']]): arm[f'signal_{channel}_{component}']=float(value)
for side in ['FL','FR','RL','RR']:
    name='CTRL_Foot_'+side
    control=bpy.data.objects.get(name)
    if control is None:
        control=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(control)
    control.empty_display_type='SPHERE';control.empty_display_size=.08
    control.location=arm.matrix_world @ arm.data.bones['leg_'+side+'_foot'].tail_local
    control.show_in_front=True;control['Instructions']='Move this target after unmuting the matching Native_IK constraint. Keep muted to preview the baked Combat_* actions.'
    bone=arm.pose.bones['leg_'+side+'_foot']
    constraint=bone.constraints.get('Native_IK') or bone.constraints.new('IK')
    constraint.name='Native_IK';constraint.target=control;constraint.chain_count=4;constraint.use_stretch=False;constraint.iterations=32;constraint.mute=True
arm['animation_library']=f"{len(data['clips'])} Combat_* actions. Choose an action in the Dope Sheet / Action Editor. Native_IK constraints are muted for FK clip playback; unmute them to pose the foot control empties."
bpy.context.scene.render.fps=data['fps'];bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=60;bpy.context.scene.frame_set(1)
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'Automaton-Combat-Rig.blend'))
print('Saved native rig:',len(bpy.data.actions),'baked actions, 4 optional IK controls, all textures packed.')
